import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { createNestApp } from './app.factory';
import { hashPassword } from './auth/auth.service';
import { PG_POOL } from './database/database.module';

export interface DemoContext {
  app: INestApplication;
  baseUrl: string;
  pool: Pool;
}

export async function startDemoApp(): Promise<DemoContext> {
  const app = await createNestApp();
  await app.listen(0, '127.0.0.1');
  const server = app.getHttpServer();
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  const pool = app.get<Pool>(PG_POOL);
  return { app, baseUrl, pool };
}

export async function ensureDemoUser(
  pool: Pool,
  email: string,
  password: string,
  role: string,
): Promise<string> {
  const passwordHash = hashPassword(password);
  const res = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, is_verified)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role = EXCLUDED.role,
           is_verified = true
     RETURNING id`,
    [email, passwordHash, role],
  );
  const userId = res.rows[0].id;
  await pool.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [userId]);
  return userId;
}

export async function cleanupDemoUsers(
  pool: Pool,
  emails: string[],
): Promise<void> {
  if (emails.length === 0) return;
  await pool.query(`DELETE FROM users WHERE email = ANY($1::text[])`, [emails]);
}

export function assertInvariant(
  actual: number,
  expected: number | number[],
  label: string,
): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(actual)) {
    throw new Error(
      `Invariant failed for '${label}': expected ${allowed.join(' or ')}, got ${actual}`,
    );
  }
}
