import { AddressInfo } from 'node:net';
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  DeleteBucketPolicyCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { createEdgeServer, buildVersionedAssetName } from './files/edge-cdn';
import { assertInvariant } from './demo-auth-helper';

async function main(): Promise<void> {
  const endpoint = process.env.STORAGE_ENDPOINT || undefined;
  const region = process.env.STORAGE_REGION || 'us-east-1';
  const bucket = process.env.STORAGE_BUCKET || 'hw26-files';
  const accessKeyId = process.env.STORAGE_ACCESS_KEY;
  const secretAccessKey = process.env.STORAGE_SECRET_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY are required');
  }

  const s3 = new S3Client({
    region,
    endpoint,
    forcePathStyle: Boolean(endpoint),
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });

  // Ensure bucket exists and is private
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await s3.send(new DeleteBucketPolicyCommand({ Bucket: bucket })).catch(() => undefined);

  // Clean up previous demo-cdn objects
  const prev = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: 'assets/' }));
  for (const obj of prev.Contents ?? []) {
    if (obj.Key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key })).catch(() => undefined);
    }
  }

  const edge = createEdgeServer(s3, bucket);
  await new Promise<void>((resolve) => edge.listen(0, '127.0.0.1', resolve));
  const edgePort = (edge.address() as AddressInfo).port;
  const edgeBaseUrl = `http://127.0.0.1:${edgePort}`;

  const createdKeys: string[] = [];
  try {
    const cssV1 = 'body { color: #111; }\n';
    const v1Key = `assets/${buildVersionedAssetName('app', 'css', cssV1)}`;
    createdKeys.push(v1Key);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: v1Key,
        Body: cssV1,
        ContentType: 'text/css',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    // 1. Direct anonymous request to storage must fail with 403
    const directUrl = endpoint
      ? `${endpoint.replace(/\/$/, '')}/${bucket}/${v1Key}`
      : `https://${bucket}.s3.${region}.amazonaws.com/${v1Key}`;
    const directRes = await fetch(directUrl);
    const directStatus = directRes.status;

    // 2. First request through edge -> MISS (200)
    const missRes = await fetch(`${edgeBaseUrl}/${v1Key}`);
    const edgeMissStatus = missRes.status;
    const missBody = await missRes.text();
    const missHeader = missRes.headers.get('x-cache');

    // 3. Second request through edge -> HIT (200)
    const hitRes = await fetch(`${edgeBaseUrl}/${v1Key}`);
    const edgeHitStatus = hitRes.status;
    const hitBody = await hitRes.text();
    const hitHeader = hitRes.headers.get('x-cache');
    const cacheHit = missHeader === 'MISS' && hitHeader === 'HIT' && hitBody === cssV1 ? 1 : 0;

    // 4. Deploy v2 under a new content-hashed URL (zero invalidations)
    const cssV2 = 'body { color: #0a84ff; }\n';
    const v2Key = `assets/${buildVersionedAssetName('app', 'css', cssV2)}`;
    createdKeys.push(v2Key);

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: v2Key,
        Body: cssV2,
        ContentType: 'text/css',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    const newName = v2Key !== v1Key ? 1 : 0;
    const v2Res = await fetch(`${edgeBaseUrl}/${v2Key}`);
    const newUrlStatus = v2Res.status;
    const v2Body = await v2Res.text();
    const contentChanged = v2Body !== missBody && v2Body === cssV2 ? 1 : 0;

    const results = [
      `direct=${directStatus}`,
      `edge-miss=${edgeMissStatus}`,
      `edge-hit=${edgeHitStatus}`,
      `cache-hit=${cacheHit}`,
      `new-name=${newName}`,
      `new-url=${newUrlStatus}`,
      `content-changed=${contentChanged}`,
    ];
    console.log(results.join('\n'));

    assertInvariant(directStatus, 403, 'direct');
    assertInvariant(edgeMissStatus, 200, 'edge-miss');
    assertInvariant(edgeHitStatus, 200, 'edge-hit');
    assertInvariant(cacheHit, 1, 'cache-hit');
    assertInvariant(newName, 1, 'new-name');
    assertInvariant(newUrlStatus, 200, 'new-url');
    assertInvariant(contentChanged, 1, 'content-changed');
  } finally {
    for (const k of createdKeys) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: k })).catch(() => undefined);
    }
    await new Promise<void>((resolve) => edge.close(() => resolve()));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
