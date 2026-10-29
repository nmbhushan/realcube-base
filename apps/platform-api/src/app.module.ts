import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PlatformInfoController } from './platform-info.controller';

@Module({
  controllers: [HealthController, PlatformInfoController],
})
export class AppModule {}
