import { Controller, Get } from '@nestjs/common';

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
    // TODO: include dependency readiness after database persistence is wired.
    return { status: 'ready', checks: { database: 'not-configured' } };
  }
}
