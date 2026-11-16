import crypto from 'node:crypto';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';

export interface ProductCard {
  id: string;
  symbol: string;
  name: string;
  sector: string;
  currentPrice: string;
  tradingStatus: string;
  stock: number;
  orderCount: number;
  totalOrderedQty: number;
  totalPositionQty: number;
  cachedAt: string;
}

export interface CacheAsideOptions {
  baseTtlSeconds?: number;
  jitterSeconds?: number;
  lockTtlMs?: number;
  waitTimeoutMs?: number;
  keyPrefix?: string;
}

const RELEASE_LOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export class CacheAsideService {
  private readonly baseTtlSeconds: number;
  private readonly jitterSeconds: number;
  private readonly lockTtlMs: number;
  private readonly waitTimeoutMs: number;
  private readonly keyPrefix: string;
  private dbCalls = 0;

  constructor(
    private readonly redis: Redis,
    private readonly dataSource: DataSource,
    options: CacheAsideOptions = {},
  ) {
    this.baseTtlSeconds = options.baseTtlSeconds ?? 300;
    this.jitterSeconds = Math.max(options.jitterSeconds ?? 60, 10);
    this.lockTtlMs = options.lockTtlMs ?? 5000;
    this.waitTimeoutMs = options.waitTimeoutMs ?? 4000;
    this.keyPrefix = options.keyPrefix ?? 'cache:product:';
  }

  resetDbCalls(): void {
    this.dbCalls = 0;
  }

  getDbCalls(): number {
    return this.dbCalls;
  }

  computeTtlWithJitter(): number {
    return this.baseTtlSeconds + Math.floor(Math.random() * (this.jitterSeconds + 1));
  }

  getCacheKey(symbol: string): string {
    return `${this.keyPrefix}${symbol.toUpperCase()}`;
  }

  getLockKey(symbol: string): string {
    return `lock:${this.getCacheKey(symbol)}`;
  }

  private async safeGet(key: string): Promise<string | null> {
    try {
      return await this.redis.get(key);
    } catch {
      return null;
    }
  }

  private async safeSet(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } catch {
      // Cache write errors (e.g. OOM) must never break user reads
    }
  }

  private async releaseLock(lockKey: string, token: string): Promise<void> {
    try {
      await this.redis.eval(RELEASE_LOCK_LUA, 1, lockKey, token);
    } catch {
      // Best-effort unlock; lock has PX TTL as safety net
    }
  }

  private async fetchProductCardFromDb(symbol: string): Promise<ProductCard | null> {
    this.dbCalls += 1;
    const rows = await this.dataSource.query(
      `
      SELECT
        p.id,
        p.symbol,
        p.name,
        p.sector,
        p.current_price AS "currentPrice",
        p.trading_status AS "tradingStatus",
        p.stock,
        COALESCE(o.order_count, 0)::int AS "orderCount",
        COALESCE(o.total_ordered_qty, 0)::int AS "totalOrderedQty",
        COALESCE(pos.total_position_qty, 0)::int AS "totalPositionQty"
      FROM products p
      LEFT JOIN (
        SELECT product_id, COUNT(*) AS order_count, SUM(quantity) AS total_ordered_qty
        FROM orders
        GROUP BY product_id
      ) o ON o.product_id = p.id
      LEFT JOIN (
        SELECT product_id, SUM(shares_count) AS total_position_qty
        FROM positions
        GROUP BY product_id
      ) pos ON pos.product_id = p.id
      WHERE UPPER(p.symbol) = UPPER($1)
      LIMIT 1
      `,
      [symbol],
    );

    if (!rows || rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      id: String(row.id),
      symbol: String(row.symbol),
      name: String(row.name),
      sector: String(row.sector),
      currentPrice: String(row.currentPrice),
      tradingStatus: String(row.tradingStatus),
      stock: Number(row.stock),
      orderCount: Number(row.orderCount),
      totalOrderedQty: Number(row.totalOrderedQty),
      totalPositionQty: Number(row.totalPositionQty),
      cachedAt: new Date().toISOString(),
    };
  }

  async getProductCard(symbol: string): Promise<ProductCard | null> {
    const cacheKey = this.getCacheKey(symbol);
    const cached = await this.safeGet(cacheKey);
    if (cached !== null) {
      return JSON.parse(cached) as ProductCard;
    }

    const lockKey = this.getLockKey(symbol);
    const deadline = Date.now() + this.waitTimeoutMs;

    while (Date.now() < deadline) {
      const token = crypto.randomUUID();
      let acquired = false;

      try {
        const res = await this.redis.set(lockKey, token, 'PX', this.lockTtlMs, 'NX');
        acquired = res === 'OK';
      } catch {
        // Redis unavailable: fall back directly to DB
        return this.fetchProductCardFromDb(symbol);
      }

      if (acquired) {
        try {
          const doubleCheck = await this.safeGet(cacheKey);
          if (doubleCheck !== null) {
            return JSON.parse(doubleCheck) as ProductCard;
          }

          const card = await this.fetchProductCardFromDb(symbol);
          if (card !== null) {
            const ttl = this.computeTtlWithJitter();
            await this.safeSet(cacheKey, JSON.stringify(card), ttl);
          }
          return card;
        } finally {
          await this.releaseLock(lockKey, token);
        }
      }

      // Another request holds the lock: wait briefly and re-read cache
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.floor(Math.random() * 15)));
      const afterWait = await this.safeGet(cacheKey);
      if (afterWait !== null) {
        return JSON.parse(afterWait) as ProductCard;
      }
    }

    // Fallback if lock wait timed out
    return this.fetchProductCardFromDb(symbol);
  }

  async invalidateProduct(symbol: string): Promise<void> {
    try {
      await this.redis.del(this.getCacheKey(symbol));
    } catch {
      // Ignore cache invalidation errors
    }
  }
}
