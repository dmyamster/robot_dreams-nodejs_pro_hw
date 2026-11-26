import { spawn } from 'node:child_process';
import * as readline from 'node:readline';
import { SIMULATED_500_ORDER_ID } from './orders/orders.repository';
import {
  makeTraceparent,
  signDemoAdminToken,
  waitForHealth,
} from './observability/demo-helpers';

interface JaegerSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  references?: Array<{ refType: string; traceID: string; spanID: string }>;
  tags?: Array<{ key: string; type: string; value: unknown }>;
}

async function fetchJaegerTrace(
  traceApiUrl: string,
  traceId: string,
): Promise<JaegerSpan[]> {
  const base = traceApiUrl.replace(/\/+$/, '');
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`${base}/api/traces/${traceId}`);
      if (res.ok) {
        const body = (await res.json()) as {
          data?: Array<{ spans?: JaegerSpan[] }>;
        };
        const spans = body.data?.[0]?.spans;
        if (Array.isArray(spans) && spans.length >= 2) {
          return spans;
        }
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return [];
}

async function main(): Promise<void> {
  const port = 22982;
  const baseUrl = `http://127.0.0.1:${port}`;
  const traceApiUrl = process.env.TRACE_API_URL || 'http://127.0.0.1:22904';
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

  try {
    await waitForHealth(baseUrl);
    const token = signDemoAdminToken();

    const { traceId, parentId, header: traceparent } = makeTraceparent();

    // Trigger a 500 error on /api/v1/orders/:id so OTel marks span status ERROR
    const res = await fetch(`${baseUrl}/api/v1/orders/${SIMULATED_500_ORDER_ID}`, {
      headers: {
        authorization: `Bearer ${token}`,
        traceparent,
        'x-tenant-id': 'tenant-trace',
      },
    });
    if (res.status !== 500) {
      throw new Error(`Expected 500 response, got ${res.status}`);
    }

    // Shutdown triggers BatchSpanProcessor flush via shutdownTracing()
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));

    const spans = await fetchJaegerTrace(traceApiUrl, traceId);
    const spanIds = new Set(spans.map((s) => s.spanID));

    let orphanSpans = 0;
    for (const s of spans) {
      const refs = s.references || [];
      for (const ref of refs) {
        if (
          ref.refType === 'CHILD_OF' &&
          ref.spanID !== parentId &&
          !spanIds.has(ref.spanID)
        ) {
          orphanSpans++;
        }
      }
    }

    const traceMatchesHeader =
      spans.length > 0 && spans.every((s) => s.traceID === traceId) ? 1 : 0;

    const spanTraceIds = new Set(spans.map((s) => s.traceID));
    const parsedLogs: Array<Record<string, any>> = [];
    for (const line of rawLines) {
      try {
        parsedLogs.push(JSON.parse(line));
      } catch {
        // ignore
      }
    }
    const matchingLogs = parsedLogs.filter(
      (l) => typeof l.trace_id === 'string' && spanTraceIds.has(l.trace_id),
    );
    const traceMatchesLog = matchingLogs.length > 0 && spans.length > 0 ? 1 : 0;

    const spanStatusError = spans.some((s) =>
      (s.tags || []).some(
        (t) =>
          (t.key === 'otel.status_code' && t.value === 'ERROR') ||
          (t.key === 'error' && t.value === true),
      ),
    )
      ? 1
      : 0;

    console.log(`spans=${spans.length}`);
    console.log(`orphan-spans=${orphanSpans}`);
    console.log(`trace-matches-header=${traceMatchesHeader}`);
    console.log(`trace-matches-log=${traceMatchesLog}`);
    console.log(`span-status-error=${spanStatusError}`);

    const ok =
      spans.length >= 2 &&
      orphanSpans === 0 &&
      traceMatchesHeader === 1 &&
      traceMatchesLog === 1 &&
      spanStatusError === 1;

    if (!ok) {
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
