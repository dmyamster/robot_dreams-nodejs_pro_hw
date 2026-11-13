import crypto from 'node:crypto';
import Redis from 'ioredis';

export interface SessionData {
  sessionId: string;
  userId: string;
  role: string;
  createdAt: string;
  lastActiveAt: string;
}

export class SessionService {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 30,
    private readonly keyPrefix = 'session:',
  ) {}

  private getKey(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  async createSession(userId: string, role = 'INVESTOR'): Promise<SessionData> {
    const sessionId = crypto.randomUUID();
    const now = new Date().toISOString();
    const data: SessionData = {
      sessionId,
      userId,
      role,
      createdAt: now,
      lastActiveAt: now,
    };
    await this.redis.set(this.getKey(sessionId), JSON.stringify(data), 'EX', this.ttlSeconds);
    return data;
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    // GETEX atomically reads the session and renews its rolling TTL
    const raw = await this.redis.getex(this.getKey(sessionId), 'EX', this.ttlSeconds);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as SessionData;
  }

  async getSessionTtl(sessionId: string): Promise<number> {
    return this.redis.ttl(this.getKey(sessionId));
  }

  async existsInRedis(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(this.getKey(sessionId))) === 1;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(this.getKey(sessionId));
  }
}
