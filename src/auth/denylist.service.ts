import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { createQueueRedis } from '../redis/redis.clients';

@Injectable()
export class DenylistService implements OnModuleDestroy {
  private readonly redis: Redis;
  private readonly keyPrefix = 'auth:denylist:';

  constructor() {
    // Store revoked jti entries on the noeviction + AOF Redis instance
    this.redis = createQueueRedis(false);
    this.redis.on('error', (err) => {
      console.warn('Denylist Redis error:', err.message);
    });
  }

  async revoke(jti: string, expUnixSeconds: number): Promise<void> {
    const remainingTtl = expUnixSeconds - Math.floor(Date.now() / 1000);
    if (remainingTtl <= 0) {
      return;
    }
    await this.redis.set(`${this.keyPrefix}${jti}`, '1', 'EX', remainingTtl);
  }

  async isRevoked(jti: string): Promise<boolean> {
    const value = await this.redis.get(`${this.keyPrefix}${jti}`);
    return value !== null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
