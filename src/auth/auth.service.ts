import {
  Injectable,
  Inject,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { PG_POOL } from '../database/database.module';
import { Env } from '../config/env.schema';
import { AccessTokenPayload, JwtService } from './jwt.service';
import { DenylistService } from './denylist.service';

export interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(derived, expected);
}

@Injectable()
export class AuthService {
  private readonly pepper: string;
  private readonly refreshTtlSeconds: number;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly configService: ConfigService<Env, true>,
    private readonly jwtService: JwtService,
    private readonly denylistService: DenylistService,
  ) {
    this.pepper = this.configService.get('REFRESH_TOKEN_PEPPER', {
      infer: true,
    });
    this.refreshTtlSeconds = this.configService.get('REFRESH_TOKEN_TTL_SECONDS', {
      infer: true,
    });
  }

  private hashRefreshToken(rawToken: string): string {
    return createHmac('sha256', this.pepper).update(rawToken).digest('hex');
  }

  private generateRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  async login(email: string, password: string): Promise<TokenPairResponse> {
    if (!email || !password) {
      throw new BadRequestException('Email and password are required');
    }

    const res = await this.pool.query<{
      id: string;
      email: string;
      password_hash: string;
      role: string;
    }>(
      `SELECT id, email, password_hash, role FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );

    const user = res.rows[0];
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const familyId = randomUUID();
    const rawRefresh = this.generateRefreshToken();
    const tokenHash = this.hashRefreshToken(rawRefresh);
    const expiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);

    await this.pool.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [user.id, familyId, tokenHash, expiresAt],
    );

    const access = this.jwtService.signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return {
      access_token: access.token,
      refresh_token: rawRefresh,
      token_type: 'Bearer',
      expires_in: this.jwtService.getAccessTtlSeconds(),
    };
  }

  async refresh(rawRefreshToken: string): Promise<TokenPairResponse> {
    if (!rawRefreshToken) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const tokenHash = this.hashRefreshToken(rawRefreshToken);
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const res = await client.query<{
        id: string;
        user_id: string;
        family_id: string;
        used_at: Date | null;
        revoked_at: Date | null;
        expires_at: Date;
        email: string;
        role: string;
      }>(
        `SELECT rt.id, rt.user_id, rt.family_id, rt.used_at, rt.revoked_at, rt.expires_at,
                u.email, u.role
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
         WHERE rt.token_hash = $1
         FOR UPDATE OF rt`,
        [tokenHash],
      );

      const row = res.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Invalid refresh token');
      }

      if (row.revoked_at !== null) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Refresh token family has been revoked');
      }

      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query('ROLLBACK');
        throw new UnauthorizedException('Refresh token expired');
      }

      // RFC 9700 §4.14.2: reuse of an already-rotated refresh token signals compromise -> revoke entire family
      if (row.used_at !== null) {
        await client.query(
          `UPDATE refresh_tokens
           SET revoked_at = now()
           WHERE family_id = $1 AND revoked_at IS NULL`,
          [row.family_id],
        );
        await client.query('COMMIT');

        console.warn(
          JSON.stringify({
            event: 'refresh_token_reuse_detected',
            family_id: row.family_id,
            user_id: row.user_id,
            kid: this.jwtService.getKid(),
            key_fingerprint: this.jwtService.getKeyFingerprint(),
          }),
        );

        throw new UnauthorizedException(
          'Refresh token reuse detected; session family revoked',
        );
      }

      await client.query(
        `UPDATE refresh_tokens SET used_at = now() WHERE id = $1`,
        [row.id],
      );

      const nextRawRefresh = this.generateRefreshToken();
      const nextTokenHash = this.hashRefreshToken(nextRawRefresh);
      const nextExpiresAt = new Date(Date.now() + this.refreshTtlSeconds * 1000);

      await client.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [row.user_id, row.family_id, nextTokenHash, nextExpiresAt],
      );

      await client.query('COMMIT');

      const access = this.jwtService.signAccessToken({
        sub: row.user_id,
        email: row.email,
        role: row.role,
      });

      return {
        access_token: access.token,
        refresh_token: nextRawRefresh,
        token_type: 'Bearer',
        expires_in: this.jwtService.getAccessTtlSeconds(),
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async logout(
    user: AccessTokenPayload,
    rawRefreshToken?: string,
  ): Promise<void> {
    // 1. Add access token jti to Redis denylist with TTL = remaining lifetime
    await this.denylistService.revoke(user.jti, user.exp);

    // 2. Revoke refresh token family in PostgreSQL
    if (rawRefreshToken) {
      const tokenHash = this.hashRefreshToken(rawRefreshToken);
      const res = await this.pool.query<{ family_id: string }>(
        `SELECT family_id FROM refresh_tokens WHERE token_hash = $1 LIMIT 1`,
        [tokenHash],
      );
      const row = res.rows[0];
      if (row) {
        await this.pool.query(
          `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
          [row.family_id],
        );
        return;
      }
    }

    await this.pool.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.sub],
    );
  }
}
