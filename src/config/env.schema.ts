import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_URL: z.string().min(1, 'DB_URL is required').default(process.env.DATABASE_URL || 'postgres://postgres@127.0.0.1:5432/broker_db'),
  DB_PASSWORD_PATH: z.string().min(1).default('./secrets/db_password'),
  BROKER_URL: z.string().default('amqp://app:app@127.0.0.1:5672'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_QUEUE_URL: z.string().default('redis://127.0.0.1:6380'),
  JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required (from vault)'),
  JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY is required (from vault)'),
  REFRESH_TOKEN_PEPPER: z.string().min(1, 'REFRESH_TOKEN_PEPPER is required (from vault)'),
  JWT_KID: z.string().min(1).default('dev-1'),
  JWT_ISSUER: z.string().min(1).default('paper-trading-broker-api'),
  JWT_AUDIENCE: z.string().min(1).default('paper-trading-clients'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
  STORAGE_ENDPOINT: z.string().optional(),
  STORAGE_REGION: z.string().min(1).default('us-east-1'),
  STORAGE_BUCKET: z.string().min(1).default('hw26-files'),
  STORAGE_ACCESS_KEY: z.string().min(1, 'STORAGE_ACCESS_KEY is required (from vault)'),
  STORAGE_SECRET_KEY: z.string().min(1, 'STORAGE_SECRET_KEY is required (from vault)'),
  PRESIGNED_PUT_TTL_SECONDS: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof envSchema>;

export function validate(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const errorDetails = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || 'config'}: ${issue.message}`)
      .join('\n');
    throw new Error(`\n❌ Environment validation failed:\n${errorDetails}\n`);
  }

  return result.data;
}
