import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DB_URL: z.string().min(1, 'DB_URL is required'),
  DB_PASSWORD_PATH: z.string().min(1).default('./secrets/db_password'),
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
