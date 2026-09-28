import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database/database.module';

@Controller()
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('health')
  async getHealth() {
    const result = await this.pool.query('SELECT 1 as ok');
    return {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: result.rows[0]?.ok === 1 ? 'connected' : 'unknown',
    };
  }

  @Get('api/v1/health')
  async getHealthV1() {
    return this.getHealth();
  }
}
