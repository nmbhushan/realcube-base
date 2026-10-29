import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from './auth/auth.decorators';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly dataSource: DataSource) {}

  @Get()
  health() {
    return {
      status: 'ok',
      service: 'enterprise-platform-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async readiness() {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'ready', dependencies: { database: 'ok' } };
    } catch {
      // Keep connection details and credentials out of public health responses.
      console.warn(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'warn',
        event: 'dependency.readiness.failed',
        dependency: 'database',
      }));
      throw new ServiceUnavailableException('Database is not ready');
    }
  }
}
