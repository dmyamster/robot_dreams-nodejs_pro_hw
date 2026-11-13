import Redis, { RedisOptions } from 'ioredis';

export function getCacheRedisUrl(): string {
  return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
}

export function getQueueRedisUrl(): string {
  return process.env.REDIS_QUEUE_URL || 'redis://127.0.0.1:6380';
}

export function parseRedisOptions(urlString: string, forWorker = false): RedisOptions {
  const url = new URL(urlString);
  const dbPath = url.pathname && url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;

  return {
    host: url.hostname || '127.0.0.1',
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isNaN(dbPath) ? 0 : dbPath,
    // BullMQ workers must wait indefinitely on reconnect; producers/cache fail fast
    maxRetriesPerRequest: forWorker ? null : 3,
    enableReadyCheck: true,
  };
}

export function createCacheRedis(): Redis {
  return new Redis(parseRedisOptions(getCacheRedisUrl(), false));
}

export function createQueueRedis(forWorker = false): Redis {
  return new Redis(parseRedisOptions(getQueueRedisUrl(), forWorker));
}

export async function getRedisConfigValue(redis: Redis, param: string): Promise<string | null> {
  const res = (await redis.config('GET', param)) as unknown;
  if (Array.isArray(res) && res.length >= 2) {
    return String(res[1]);
  }
  if (res && typeof res === 'object' && param in (res as Record<string, unknown>)) {
    return String((res as Record<string, unknown>)[param]);
  }
  return null;
}
