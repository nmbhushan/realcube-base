import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { AdminController } from './admin.controller';
import { BootstrapController } from './bootstrap.controller';
import { HealthController } from './health.controller';
import { PlatformInfoController } from './platform-info.controller';
import {
  AccessChangeOutbox,
  AuditLog,
  PlatformAdminGrant,
  PlatformUser,
  Project,
  Tenant,
  TenantMembership,
  UserProjectAccess,
} from './entities';
import { OutboxPublisherService } from './outbox/outbox-publisher.service';

const entities = [
  AccessChangeOutbox,
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
  controllers: [HealthController, PlatformInfoController, AdminController, BootstrapController],
  providers: [OutboxPublisherService],
})
export class AppModule {}
