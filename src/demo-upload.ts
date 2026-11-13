import 'reflect-metadata';
import * as net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  startDemoApp,
  ensureDemoUser,
  cleanupDemoUsers,
  assertInvariant,
} from './demo-auth-helper';
import { StorageService } from './files/storage.service';

const execFileAsync = promisify(execFile);

const DEMO_EMAIL = 'demo-upload@broker.local';
const DEMO_PASS = 'DemoUploadPass123!';

function isPortAlive(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function putViaIsolatedProcess(
  uploadUrl: string,
  contentType: string,
  bodyText: string,
): Promise<number> {
  const script = `
    (async () => {
      const res = await fetch(process.argv[1], {
        method: 'PUT',
        headers: { 'Content-Type': process.argv[2] },
        body: process.argv[3],
      });
      console.log(res.status);
    })().catch((e) => { console.error(e); process.exit(1); });
  `;
  const { stdout } = await execFileAsync(
    process.execPath,
    ['-e', script, uploadUrl, contentType, bodyText],
    { env: { PATH: process.env.PATH ?? '' } },
  );
  return Number(stdout.trim());
}

async function main(): Promise<void> {
  let ctx1 = await startDemoApp();
  let ctx2: Awaited<ReturnType<typeof startDemoApp>> | null = null;
  const storage = ctx1.app.get(StorageService);
  const createdKeys: string[] = [];
  let userId = '';

  try {
    await storage.ensureBucketPrivate();
    await cleanupDemoUsers(ctx1.pool, [DEMO_EMAIL]);

    userId = await ensureDemoUser(ctx1.pool, DEMO_EMAIL, DEMO_PASS, 'USER');
    await storage.cleanupPrefix(`uploads/${userId}/`);

    const loginRes = await fetch(`${ctx1.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASS }),
    });
    assertInvariant(loginRes.status, 200, 'login');
    const { access_token: token } = (await loginRes.json()) as { access_token: string };

    const payload = 'hello-presigned-direct-upload';

    // 1. Intent with malicious filename -> server ignores filename
    const intentRes = await fetch(`${ctx1.baseUrl}/uploads/intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        filename: '../../etc/passwd',
        contentType: 'text/plain',
        size: Buffer.byteLength(payload),
      }),
    });
    const intentStatus = intentRes.status;
    assertInvariant(intentStatus, 200, 'intent');
    const intentData = (await intentRes.json()) as {
      fileId: string;
      key: string;
      uploadUrl: string;
    };
    createdKeys.push(intentData.key);

    const keyFromServer =
      intentData.key.startsWith(`uploads/${userId}/`) &&
      !/\.\.|etc|passwd/.test(intentData.key)
        ? 1
        : 0;

    // 2. Stop API before uploading bytes
    const port1 = Number(new URL(ctx1.baseUrl).port);
    await ctx1.app.close();
    const alive = await isPortAlive(port1);
    const apiAlive = alive ? 1 : 0;

    // 3. Separate process without any storage credentials uploads directly to storage
    const putOffline = await putViaIsolatedProcess(
      intentData.uploadUrl,
      'text/plain',
      payload,
    );

    // 4. Start API on a fresh ephemeral port (avoids global fetch dead-socket reuse)
    ctx2 = await startDemoApp();
    const commitRes = await fetch(`${ctx2.baseUrl}/uploads/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fileId: intentData.fileId }),
    });
    const commitStatus = commitRes.status;

    // 5. Commit without uploading bytes -> 4xx (409)
    const intent2Res = await fetch(`${ctx2.baseUrl}/uploads/intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contentType: 'text/plain',
        size: 16,
      }),
    });
    assertInvariant(intent2Res.status, 200, 'intent-2');
    const intent2Data = (await intent2Res.json()) as {
      fileId: string;
      key: string;
      uploadUrl: string;
    };
    createdKeys.push(intent2Data.key);

    const commitWithoutBytesRes = await fetch(`${ctx2.baseUrl}/uploads/commit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ fileId: intent2Data.fileId }),
    });
    const commitWithoutBytes = commitWithoutBytesRes.status;

    // 6. Tampered object key in presigned URL -> 403
    const tamperedUrl = new URL(intent2Data.uploadUrl);
    tamperedUrl.pathname = tamperedUrl.pathname.replace(/[^/]+$/, 'tampered-key.txt');
    const tamperedRes = await fetch(tamperedUrl.toString(), {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'tampered-payload',
    });
    const tamperedStatus = tamperedRes.status;

    // 7. Expired presigned URL -> 403
    const shortLivedUrl = await storage.presignPut(intent2Data.key, 'text/plain', 1);
    await new Promise((r) => setTimeout(r, 2000));
    const expiredRes = await fetch(shortLivedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/plain' },
      body: 'expired-payload',
    });
    const expiredStatus = expiredRes.status;

    const results = [
      `intent=${intentStatus}`,
      `key-from-server=${keyFromServer}`,
      `api-alive=${apiAlive}`,
      `put-offline=${putOffline}`,
      `commit=${commitStatus}`,
      `commit-without-bytes=${commitWithoutBytes}`,
      `tampered=${tamperedStatus}`,
      `expired=${expiredStatus}`,
    ];
    console.log(results.join('\n'));

    assertInvariant(intentStatus, 200, 'intent');
    assertInvariant(keyFromServer, 1, 'key-from-server');
    assertInvariant(apiAlive, 0, 'api-alive');
    assertInvariant(putOffline, 200, 'put-offline');
    assertInvariant(commitStatus, 200, 'commit');
    if (commitWithoutBytes < 400 || commitWithoutBytes >= 500) {
      throw new Error(`Expected 4xx for commit-without-bytes, got ${commitWithoutBytes}`);
    }
    assertInvariant(tamperedStatus, 403, 'tampered');
    assertInvariant(expiredStatus, 403, 'expired');
  } finally {
    const activePool = ctx2?.pool ?? ctx1.pool;
    for (const k of createdKeys) {
      await storage.deleteObject(k).catch(() => undefined);
    }
    if (userId) {
      await storage.cleanupPrefix(`uploads/${userId}/`).catch(() => undefined);
    }
    await cleanupDemoUsers(activePool, [DEMO_EMAIL]).catch(() => undefined);
    if (ctx2) {
      await ctx2.app.close().catch(() => undefined);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
