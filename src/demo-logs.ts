import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as readline from 'node:readline';
import {
  makeTraceparent,
  signDemoAdminToken,
  waitForHealth,
} from './observability/demo-helpers';

async function main(): Promise<void> {
  const port = 22981;
  const baseUrl = `http://127.0.0.1:${port}`;
  const rawLines: string[] = [];

  const child = spawn(process.execPath, ['dist/src/main.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      DRAIN_DELAY_MS: '0',
      STARTUP_WARMUP_MS: '0',
      LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const rlOut = readline.createInterface({ input: child.stdout });
  rlOut.on('line', (line) => {
    if (line.trim()) rawLines.push(line);
  });

  const stderrLines: string[] = [];
  const rlErr = readline.createInterface({ input: child.stderr });
  rlErr.on('line', (line) => {
    if (line.trim()) stderrLines.push(line);
  });

  try {
    await waitForHealth(baseUrl);
    const token = signDemoAdminToken();

    // 1. Single traced request through 3 layers
    const single = makeTraceparent();
    const singleRes = await fetch(
      `${baseUrl}/api/v1/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          traceparent: single.header,
          'x-tenant-id': 'tenant-alpha',
          'idempotency-key': `idem-single-${randomUUID()}`,
        },
      },
    );
    if (!singleRes.ok) {
      throw new Error(`Single request failed with status ${singleRes.status}`);
    }

    // 2. Burst of 8 concurrent requests with distinct traceparents
    const burstCount = 8;
    const burstTraces = Array.from({ length: burstCount }, () => makeTraceparent());
    const burstResponses = await Promise.all(
      burstTraces.map((tp, idx) =>
        fetch(`${baseUrl}/api/v1/orders/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11`, {
          headers: {
            authorization: `Bearer ${token}`,
            traceparent: tp.header,
            'x-tenant-id': `tenant-burst-${idx}`,
            'idempotency-key': `idem-burst-${idx}`,
          },
        }),
      ),
    );
    for (const res of burstResponses) {
      if (!res.ok) {
        throw new Error(`Burst request failed with status ${res.status}`);
      }
    }

    // 3. Redaction test: Authorization Bearer + password in auth login body
    const authMarker = `SECRET_BEARER_MARKER_${randomUUID()}`;
    const passMarker = `SECRET_PASS_MARKER_${randomUUID()}`;
    const loginTrace = makeTraceparent();
    await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${authMarker}`,
        traceparent: loginTrace.header,
      },
      body: JSON.stringify({
        email: 'demo-redact@example.com',
        password: passMarker,
      }),
    });

    // Give stdout a brief moment to flush
    await new Promise((r) => setTimeout(r, 200));

    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    // Parse & verify logs
    let nonJsonLines = 0;
    const parsedLogs: Array<Record<string, any>> = [];
    for (const line of rawLines) {
      try {
        parsedLogs.push(JSON.parse(line));
      } catch {
        nonJsonLines++;
      }
    }

    const singleLogs = parsedLogs.filter((l) => l.trace_id === single.traceId);
    const appLayers = new Set(
      singleLogs
        .map((l) => l.layer)
        .filter((layer) => typeof layer === 'string' && layer.startsWith('orders.')),
    );
    const distinctTraceIds = new Set(
      singleLogs.map((l) => l.trace_id).filter(Boolean),
    ).size;
    const traceIdMatchesHeader =
      singleLogs.length > 0 &&
      singleLogs.every((l) => l.trace_id === single.traceId)
        ? 1
        : 0;

    // Group burst logs by trace_id
    const burstTraceSet = new Set(burstTraces.map((t) => t.traceId));
    const burstGroups = new Map<string, Array<Record<string, any>>>();
    for (const log of parsedLogs) {
      if (typeof log.trace_id === 'string' && burstTraceSet.has(log.trace_id)) {
        const list = burstGroups.get(log.trace_id) || [];
        if (typeof log.layer === 'string' && log.layer.startsWith('orders.')) {
          list.push(log);
        }
        burstGroups.set(log.trace_id, list);
      }
    }
    const groupSizes = Array.from(burstGroups.values()).map((g) => g.length);
    const minGroupSize = groupSizes.length > 0 ? Math.min(...groupSizes) : 0;
    const maxGroupSize = groupSizes.length > 0 ? Math.max(...groupSizes) : 0;
    const burstUneven =
      burstGroups.size === burstCount &&
      minGroupSize === maxGroupSize &&
      minGroupSize >= 3
        ? 0
        : 1;

    const loginLogs = parsedLogs.filter((l) => l.trace_id === loginTrace.traceId);
    const secretReqLogged = loginLogs.length > 0 ? 1 : 0;
    const joinedRaw = rawLines.join('\n');
    const secretInLogs =
      joinedRaw.includes(authMarker) || joinedRaw.includes(passMarker) ? 1 : 0;

    console.log(`non-json-lines=${nonJsonLines}`);
    console.log(`layers=${appLayers.size}`);
    console.log(`distinct-trace-ids=${distinctTraceIds}`);
    console.log(`trace-id-matches-header=${traceIdMatchesHeader}`);
    console.log(`burst=${burstCount}`);
    console.log(`burst-trace-ids=${burstGroups.size}`);
    console.log(`burst-uneven=${burstUneven}`);
    console.log(`secret-req-logged=${secretReqLogged}`);
    console.log(`secret-in-logs=${secretInLogs}`);

    const ok =
      nonJsonLines === 0 &&
      appLayers.size >= 3 &&
      distinctTraceIds === 1 &&
      traceIdMatchesHeader === 1 &&
      burstGroups.size === burstCount &&
      burstUneven === 0 &&
      secretReqLogged === 1 &&
      secretInLogs === 0;

    if (!ok) {
      if (stderrLines.length > 0) {
        console.error(stderrLines.join('\n'));
      }
      process.exit(1);
    }
  } finally {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
