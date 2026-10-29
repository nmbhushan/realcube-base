import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.decorators';

@Public()
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      service: 'enterprise-platform-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  readiness() {
    // The DB connection is validated at startup by TypeORM. Add deeper dependency checks for production.
    return { status: 'ready' };
  }
}
