import * as http from 'node:http';
import { createHash } from 'node:crypto';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

interface CacheEntry {
  body: Buffer;
  contentType: string;
  cacheControl: string;
  expiresAt: number;
}

export function buildVersionedAssetName(
  baseName: string,
  ext: string,
  content: Buffer | string,
): string {
  const hash8 = createHash('sha256').update(content).digest('hex').slice(0, 8);
  return `${baseName}.${hash8}.${ext}`;
}

function parseMaxAgeMs(cacheControl?: string): number {
  if (!cacheControl) return 0;
  if (/no-store|private/i.test(cacheControl)) return 0;
  const match = cacheControl.match(/max-age=(\d+)/i);
  return match ? Number(match[1]) * 1000 : 0;
}

export function createEdgeServer(s3: S3Client, bucket: string): http.Server {
  const cache = new Map<string, CacheEntry>();

  return http.createServer(async (req, res) => {
    const key = decodeURIComponent((req.url ?? '/').split('?')[0].replace(/^\/+/, ''));
    if (!key) {
      res.writeHead(400).end('Missing object key');
      return;
    }

    const cached = cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      res.writeHead(200, {
        'Content-Type': cached.contentType,
        'Cache-Control': cached.cacheControl,
        'X-Cache': 'HIT',
      });
      res.end(cached.body);
      return;
    }

    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const chunks: Buffer[] = [];
      for await (const chunk of obj.Body as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks);
      const contentType = obj.ContentType || 'application/octet-stream';
      const cacheControl = obj.CacheControl || '';
      const ttlMs = parseMaxAgeMs(cacheControl);

      if (ttlMs > 0) {
        cache.set(key, {
          body,
          contentType,
          cacheControl,
          expiresAt: Date.now() + ttlMs,
        });
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
        'X-Cache': 'MISS',
      });
      res.end(body);
    } catch (err: any) {
      const status = err?.$metadata?.httpStatusCode === 404 ? 404 : 502;
      res.writeHead(status).end(status === 404 ? 'Not Found' : 'Origin Error');
    }
  });
}
