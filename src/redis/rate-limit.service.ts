import crypto from 'node:crypto';
import Redis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

local windowStart = now - windowMs
redis.call("ZREMRANGEBYSCORE", key, "-inf", windowStart)
local current = redis.call("ZCARD", key)

if current < limit then
  redis.call("ZADD", key, now, member)
  redis.call("PEXPIRE", key, windowMs)
  return {1, limit - current - 1, 0}
else
  local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
  local retryAfterMs = windowMs
  if oldest[2] then
    retryAfterMs = math.max(1, tonumber(oldest[2]) + windowMs - now)
  end
  return {0, 0, math.ceil(retryAfterMs / 1000)}
end
`;

export class RateLimitService {
  constructor(
    private readonly redis: Redis,
    private readonly limit = 5,
    private readonly windowMs = 10_000,
    private readonly keyPrefix = 'ratelimit:',
  ) {}

  getLimit(): number {
    return this.limit;
  }

  private getKey(clientKey: string): string {
    return `${this.keyPrefix}${clientKey}`;
  }

  async consume(clientKey: string): Promise<RateLimitResult> {
    const now = Date.now();
    const member = `${now}:${crypto.randomUUID()}`;
    const res = (await this.redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      this.getKey(clientKey),
      String(now),
      String(this.windowMs),
      String(this.limit),
      member,
    )) as [number, number, number];

    return {
      allowed: Number(res[0]) === 1,
      remaining: Number(res[1]),
      retryAfterSeconds: Number(res[2]),
    };
  }

  async reset(clientKey: string): Promise<void> {
    await this.redis.del(this.getKey(clientKey));
  }
}
