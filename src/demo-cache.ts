import 'reflect-metadata';
import AppDataSource from './data-source';
import { CacheAsideService, createCacheRedis, getRedisConfigValue } from './redis';

export async function runDemoCache(): Promise<void> {
  const dataSource = AppDataSource.isInitialized
    ? AppDataSource
    : await AppDataSource.initialize();

  const cacheRedis = createCacheRedis();
  const runId = Date.now();
  const cache = new CacheAsideService(cacheRedis, dataSource, {
    baseTtlSeconds: 300,
    jitterSeconds: 60,
    lockTtlMs: 5000,
    waitTimeoutMs: 5000,
    keyPrefix: `cache:demo:${runId}:product:`,
  });

  try {
    // 1. Verify Redis cache instance configuration at runtime
    const policy = await getRedisConfigValue(cacheRedis, 'maxmemory-policy');
    const maxmemoryRaw = await getRedisConfigValue(cacheRedis, 'maxmemory');
    const cacheLru = policy !== null && policy !== 'noeviction' ? 1 : 0;
    const cacheMaxmemory = maxmemoryRaw !== null && Number(maxmemoryRaw) > 0 ? 1 : 0;

    // Ensure target product exists in PostgreSQL
    await dataSource.query(
      `
      INSERT INTO "products" ("symbol", "name", "description", "sector", "current_price", "trading_status", "stock")
      VALUES ('AAPL', 'Apple Inc.', 'Apple Inc. common stock', 'Technology', 22050, 'ACTIVE', 100)
      ON CONFLICT ("symbol") DO NOTHING
      `,
    );

    // 2. Warm >= 50 keys with jittered TTL and measure distinct TTL values
    const warmed = 60;
    const warmKeys: string[] = [];
    for (let i = 0; i < warmed; i += 1) {
      const key = `cache:demo:${runId}:warm:${i}`;
      const ttl = cache.computeTtlWithJitter();
      await cacheRedis.set(key, JSON.stringify({ index: i }), 'EX', ttl);
      warmKeys.push(key);
    }

    const ttlSet = new Set<number>();
    for (const key of warmKeys) {
      const ttl = await cacheRedis.ttl(key);
      if (ttl > 0) {
        ttlSet.add(ttl);
      }
    }
    const ttlDistinct = ttlSet.size;

    // 3. Cold key stampede test: N >= 20 concurrent requests -> 1 DB call
    const concurrent = 25;
    await cacheRedis.del(cache.getCacheKey('AAPL'), cache.getLockKey('AAPL'));
    cache.resetDbCalls();

    await Promise.all(
      Array.from({ length: concurrent }, () => cache.getProductCard('AAPL')),
    );
    const dbCalls = cache.getDbCalls();

    // 4. Warm cache test: 100 reads -> 0 DB calls
    cache.resetDbCalls();
    for (let i = 0; i < 100; i += 1) {
      await cache.getProductCard('AAPL');
    }
    const dbCallsWarm = cache.getDbCalls();

    // Self-clean demo keys
    await cacheRedis.del(cache.getCacheKey('AAPL'), cache.getLockKey('AAPL'), ...warmKeys);

    console.log(`cache-lru=${cacheLru}`);
    console.log(`cache-maxmemory=${cacheMaxmemory}`);
    console.log(`warmed=${warmed}`);
    console.log(`ttl-distinct=${ttlDistinct}`);
    console.log(`concurrent=${concurrent}`);
    console.log(`db-calls=${dbCalls}`);
    console.log(`db-calls-warm=${dbCallsWarm}`);
  } finally {
    await cacheRedis.quit();
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

if (require.main === module) {
  runDemoCache().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
