import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { AdminController } from './admin.controller';
import { HealthController } from './health.controller';
import {
  AuditLog, PlatformUser, Project, Tenant, TenantMembership, UserProjectAccess,
} from './entities';

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.PLATFORM_DATABASE_URL,
      entities: [AuditLog, PlatformUser, Project, Tenant, TenantMembership, UserProjectAccess],
      synchronize: false,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
      extra: { max: Number(process.env.DB_POOL_MAX ?? 10) },
    }),
    TypeOrmModule.forFeature([AuditLog, PlatformUser, Project, Tenant, TenantMembership, UserProjectAccess]),
  ],
  controllers: [HealthController, AdminController],
})
export class AppModule {}
