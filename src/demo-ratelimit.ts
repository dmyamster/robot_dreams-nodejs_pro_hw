import http from 'node:http';
import { AddressInfo } from 'node:net';
import { RateLimitService, createCacheRedis } from './redis';

function startPodServer(rateLimiter: RateLimitService): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const clientKey = (req.headers['x-client-id'] as string) || 'anonymous';
      const result = await rateLimiter.consume(clientKey);

      if (result.allowed) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: true, remaining: result.remaining }));
      } else {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', String(result.retryAfterSeconds));
        res.end(JSON.stringify({ ok: false, error: 'Too Many Requests' }));
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

export async function runDemoRateLimit(): Promise<void> {
  const limit = 5;
  const windowMs = 10_000;
  const redisPod1 = createCacheRedis();
  const redisPod2 = createCacheRedis();

  const limiter1 = new RateLimitService(redisPod1, limit, windowMs);
  const limiter2 = new RateLimitService(redisPod2, limit, windowMs);

  const pod1 = await startPodServer(limiter1);
  const pod2 = await startPodServer(limiter2);
  const pods = [pod1.port, pod2.port];

  const clientKey = `demo-client-${Date.now()}`;
  const totalRequests = 8;
  let allowed = 0;
  let blocked = 0;
  let lastBlockedStatus = 0;
  let retryAfterPresent = 0;

  try {
    for (let i = 0; i < totalRequests; i += 1) {
      const port = pods[i % pods.length];
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/orders`, {
        headers: { 'x-client-id': clientKey },
      });

      if (response.status === 200) {
        allowed += 1;
      } else {
        blocked += 1;
        lastBlockedStatus = response.status;
        const retryAfter = response.headers.get('retry-after');
        if (retryAfter !== null && Number(retryAfter) >= 1) {
          retryAfterPresent = 1;
        }
      }
    }

    await limiter1.reset(clientKey);

    console.log(`instances=${pods.length}`);
    console.log(`limit=${limit}`);
    console.log(`requests=${totalRequests}`);
    console.log(`allowed=${allowed}`);
    console.log(`blocked=${blocked}`);
    console.log(`status=${lastBlockedStatus}`);
    console.log(`retry-after=${retryAfterPresent}`);
  } finally {
    await closeServer(pod1.server);
    await closeServer(pod2.server);
    await redisPod1.quit();
    await redisPod2.quit();
  }
}

if (require.main === module) {
  runDemoRateLimit().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
