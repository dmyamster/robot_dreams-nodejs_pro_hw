import 'reflect-metadata';
import {
  startDemoApp,
  ensureDemoUser,
  cleanupDemoUsers,
  assertInvariant,
} from './demo-auth-helper';
import { StorageService } from './files/storage.service';

const DEMO_EMAIL = 'demo-multipart@broker.local';
const DEMO_PASS = 'DemoMultipartPass123!';

async function main(): Promise<void> {
  const ctx = await startDemoApp();
  const storage = ctx.app.get(StorageService);
  let userId = '';

  try {
    await storage.ensureBucketPrivate();
    await cleanupDemoUsers(ctx.pool, [DEMO_EMAIL]);

    userId = await ensureDemoUser(ctx.pool, DEMO_EMAIL, DEMO_PASS, 'USER');
    await storage.cleanupPrefix(`uploads/${userId}/`);

    const loginRes = await fetch(`${ctx.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASS }),
    });
    assertInvariant(loginRes.status, 200, 'login');
    const { access_token: token } = (await loginRes.json()) as { access_token: string };

    // 10 MiB + 1 KiB -> 3 parts with 5 MiB calculated partSize (5 MiB, 5 MiB, 1 KiB)
    const totalSize = 10 * 1024 * 1024 + 1024;
    const payload = Buffer.alloc(totalSize, 0x61);

    const intentRes = await fetch(`${ctx.baseUrl}/uploads/intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        contentType: 'application/octet-stream',
        size: totalSize,
      }),
    });
    assertInvariant(intentRes.status, 200, 'intent');
    const intent = (await intentRes.json()) as {
      fileId: string;
      key: string;
      mode: string;
      partSize: number;
      partCount: number;
      parts: Array<{ partNumber: number; uploadUrl: string }>;
    };
    assertInvariant(intent.partCount, 3, 'partCount');

    // Process 1: upload parts 1 and 2, then simulate crash before part 3
    for (const part of intent.parts.slice(0, 2)) {
      const start = (part.partNumber - 1) * intent.partSize;
      const end = Math.min(start + intent.partSize, totalSize);
      const chunk = payload.subarray(start, end);
      const putRes = await fetch(part.uploadUrl, {
        method: 'PUT',
        body: chunk,
      });
      assertInvariant(putRes.status, 200, `upload-part-${part.partNumber}`);
    }

    // Object must NOT exist before CompleteMultipartUpload
    const headBefore = await storage.headObject(intent.key);
    const headBeforeComplete = headBefore.exists ? 200 : 404;

    // Process 2 (resume): ask API which parts are missing via ListParts
    const partsRes = await fetch(`${ctx.baseUrl}/uploads/${intent.fileId}/parts`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assertInvariant(partsRes.status, 200, 'list-parts');
    const partsInfo = (await partsRes.json()) as {
      missingParts: Array<{ partNumber: number; uploadUrl: string }>;
    };

    let resumedParts = 0;
    for (const missing of partsInfo.missingParts) {
      const start = (missing.partNumber - 1) * intent.partSize;
      const end = Math.min(start + intent.partSize, totalSize);
      const chunk = payload.subarray(start, end);
      const putRes = await fetch(missing.uploadUrl, {
        method: 'PUT',
        body: chunk,
      });
      assertInvariant(putRes.status, 200, `resume-part-${missing.partNumber}`);
      resumedParts += 1;
    }

    // Complete multipart upload
    const completeRes = await fetch(`${ctx.baseUrl}/uploads/${intent.fileId}/complete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const completeStatus = completeRes.status;

    const headAfter = await storage.headObject(intent.key);
    const sizeMatch = headAfter.exists && headAfter.contentLength === totalSize ? 1 : 0;
    const etagMultipart =
      headAfter.exists && headAfter.etag && /-\d+"?$/.test(headAfter.etag) ? 1 : 0;

    const results = [
      `head-before-complete=${headBeforeComplete}`,
      `resumed-parts=${resumedParts}`,
      `complete=${completeStatus}`,
      `size-match=${sizeMatch}`,
      `etag-multipart=${etagMultipart}`,
    ];
    console.log(results.join('\n'));

    assertInvariant(headBeforeComplete, 404, 'head-before-complete');
    assertInvariant(resumedParts, 1, 'resumed-parts');
    assertInvariant(completeStatus, 200, 'complete');
    assertInvariant(sizeMatch, 1, 'size-match');
    assertInvariant(etagMultipart, 1, 'etag-multipart');
  } finally {
    if (userId) {
      await storage.cleanupPrefix(`uploads/${userId}/`).catch(() => undefined);
    }
    await cleanupDemoUsers(ctx.pool, [DEMO_EMAIL]).catch(() => undefined);
    await ctx.app.close().catch(() => undefined);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
