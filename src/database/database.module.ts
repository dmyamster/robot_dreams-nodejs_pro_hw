import { Module, Global, OnModuleDestroy, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Env } from '../config/env.schema';

export const PG_POOL = 'PG_POOL';

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Env, true>) => {
        const dbUrl = configService.get('DB_URL', { infer: true });
        const secretPath = configService.get('DB_PASSWORD_PATH', { infer: true });
        const resolvedPath = path.resolve(process.cwd(), secretPath);

        const url = new URL(dbUrl);
        const pool = new Pool({
          host: url.hostname || 'localhost',
          port: url.port ? Number(url.port) : 5432,
          user: url.username || 'postgres',
          database: url.pathname.replace(/^\//, '') || 'postgres',
          password: async () => {
            const password = await fs.promises.readFile(resolvedPath, 'utf8');
            return password.trim();
          },
          max: 10,
          idleTimeoutMillis: 10000,
        });

        // Handle idle client errors when connections are closed by pg_terminate_backend
        pool.on('error', (err) => {
          console.warn('Database pool idle client error (handled):', err.message);
        });

        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
