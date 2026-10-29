import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { AdminController } from './admin.controller';
import { PlatformAccessController } from './platform-access.controller';
import { InvitationController } from './invitation.controller';
import { BootstrapController } from './bootstrap.controller';
import { HealthController } from './health.controller';
import { PlatformInfoController } from './platform-info.controller';
import {
  AccessChangeOutbox,
  PlatformUserInvitation,
  AuditLog,
  PlatformAdminGrant,
  PlatformUser,
  Project,
  Tenant,
  TenantMembership,
  UserProjectAccess,
} from './entities';
import { OutboxPublisherService } from './outbox/outbox-publisher.service';
import { RequestObservabilityInterceptor } from './observability/request-observability.interceptor';

const entities = [
  AccessChangeOutbox,
  PlatformUserInvitation,
  AuditLog,
  PlatformAdminGrant,
  PlatformUser,
  Project,
  Tenant,
  TenantMembership,
  UserProjectAccess,
];

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.PLATFORM_DATABASE_URL,
      entities,
      synchronize: false,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
      extra: { max: Number(process.env.DB_POOL_MAX ?? 10) },
    }),
    TypeOrmModule.forFeature(entities),
  ],
  controllers: [HealthController, PlatformInfoController, AdminController, PlatformAccessController, InvitationController, BootstrapController],
  providers: [OutboxPublisherService, { provide: APP_INTERCEPTOR, useClass: RequestObservabilityInterceptor }],
})
export class AppModule {}
