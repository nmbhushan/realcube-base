import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PIMS_POOL } from './db/database.constants';

@Controller('health')
export class HealthController {
  constructor(@Inject(PIMS_POOL) private readonly pool: Pool) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.pool.query('SELECT 1');
      return { status: 'ready' };
    } catch {
      throw new ServiceUnavailableException('PIMS database is not ready');
    }
  }
}
