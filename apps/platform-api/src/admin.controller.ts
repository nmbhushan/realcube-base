import {
  BadRequestException, ConflictException, Controller, Get, NotFoundException, Post, Body, Query,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import type { JWTPayload } from 'jose';
import { CurrentPrincipal, RequirePermission } from './auth/auth.decorators';
import { assertActiveTenantMembership } from './tenant-membership.policy';
import { AuditLog, PlatformUser, Project, Tenant, TenantMembership, UserProjectAccess } from './entities';

class CreateTenantDto {
  @IsString() @IsNotEmpty() @MaxLength(100)
  externalKey!: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  name!: string;
}

class CreateUserProfileDto {
  @IsUUID()
  tenantId!: string;

  @IsString() @IsNotEmpty() @MaxLength(255)
  identitySubject!: string;

  @IsOptional() @IsEmail() @MaxLength(320)
  email?: string;

  @IsOptional() @IsString() @MaxLength(200)
  displayName?: string;
}

class SetProjectAccessDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  userId!: string;

  @IsString() @IsNotEmpty() @MaxLength(32)
  projectCode!: string;

  @IsIn(['granted', 'revoked'])
  status!: 'granted' | 'revoked';
}

@Controller('admin')
@RequirePermission('platform:admin')
export class AdminController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('projects')
  async listProjects() {
    return this.dataSource.getRepository(Project).find({ order: { name: 'ASC' } });
  }

  @Get('tenants')
  async listTenants() {
    return this.dataSource.getRepository(Tenant).find({ order: { createdAt: 'DESC' } });
  }

  @Post('tenants')
  async createTenant(
    @Body() dto: CreateTenantDto,
    @CurrentPrincipal() principal: JWTPayload,
  ) {
    if (!dto.externalKey.trim() || !dto.name.trim()) {
      throw new BadRequestException('Tenant key and name cannot be blank');
    }
    return this.dataSource.transaction(async (manager) => {
      const repository = manager.getRepository(Tenant);
      const duplicate = await repository.findOneBy({ externalKey: dto.externalKey });
      if (duplicate) throw new ConflictException('Tenant external key already exists');

      const tenant = await repository.save(repository.create({
        externalKey: dto.externalKey.trim(),
        name: dto.name.trim(),
        status: 'active',
      }));
      await this.writeAudit(manager, principal, {
        tenantId: tenant.id,
        action: 'tenant.created',
        targetType: 'tenant',
        targetId: tenant.id,
        details: { externalKey: tenant.externalKey },
      });
      return tenant;
    });
  }

  @Get('users')
  async listUsers() {
    return this.dataSource.getRepository(PlatformUser).find({
      select: { id: true, email: true, displayName: true, status: true, createdAt: true },
      order: { createdAt: 'DESC' },
    });
  }

  @Post('users')
  async createUserProfile(
    @Body() dto: CreateUserProfileDto,
    @CurrentPrincipal() principal: JWTPayload,
  ) {
    if (!principal.iss || !principal.sub) {
      throw new BadRequestException('Validated issuer and administrator subject are required');
    }

    return this.dataSource.transaction(async (manager) => {
      const tenant = await manager.getRepository(Tenant).findOneBy({ id: dto.tenantId });
      if (!tenant || tenant.status !== 'active') {
        throw new NotFoundException('Active tenant not found');
      }
      const users = manager.getRepository(PlatformUser);
      const existing = await users.findOneBy({
        oidcIssuer: principal.iss!,
        oidcSubject: dto.identitySubject,
      });
      if (existing) throw new ConflictException('This OIDC identity is already onboarded');

      const user = await users.save(users.create({
        oidcIssuer: principal.iss!,
        oidcSubject: dto.identitySubject,
        email: dto.email?.trim().toLowerCase() ?? null,
        displayName: dto.displayName?.trim() ?? null,
        status: 'active',
      }));
      await manager.getRepository(TenantMembership).save(
        manager.getRepository(TenantMembership).create({
          tenantId: tenant.id,
          userId: user.id,
          status: 'active',
        }),
      );
      await this.writeAudit(manager, principal, {
        tenantId: tenant.id,
        action: 'user.profile_created',
        targetType: 'user',
        targetId: user.id,
        details: { userId: user.id, tenantId: tenant.id },
      });

      // Do not return the OIDC subject/issuer in the API response.
      return {
        id: user.id, email: user.email, displayName: user.displayName,
        status: user.status, tenantId: tenant.id,
      };
    });
  }

  @Get('entitlements')
  async listEntitlements(@Query('tenantId') tenantId: string) {
    if (!tenantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenantId)) {
      throw new BadRequestException('A valid tenantId UUID is required');
    }
    return this.dataSource.query(
      `SELECT a.tenant_id AS "tenantId", a.user_id AS "userId",
              u.email, u.display_name AS "displayName",
              a.project_code AS "projectCode", p.name AS "projectName",
              a.status, a.entitlement_version AS "entitlementVersion",
              a.updated_at AS "updatedAt"
         FROM user_project_access a
         JOIN users u ON u.id = a.user_id
         JOIN projects p ON p.code = a.project_code
        WHERE a.tenant_id = $1
        ORDER BY u.email, p.name`,
      [tenantId],
    );
  }

  @Post('project-access')
  async setProjectAccess(
    @Body() dto: SetProjectAccessDto,
    @CurrentPrincipal() principal: JWTPayload,
  ) {
    const projectCode = dto.projectCode.trim().toUpperCase();
    if (!projectCode) throw new BadRequestException('projectCode cannot be blank');
    return this.dataSource.transaction(async (manager) => {
      const tenant = await manager.getRepository(Tenant).findOneBy({ id: dto.tenantId });
      if (!tenant || tenant.status !== 'active') throw new NotFoundException('Active tenant not found');

      const user = await manager.getRepository(PlatformUser).findOneBy({ id: dto.userId });
      if (!user || user.status !== 'active') throw new NotFoundException('Active user not found');

      const membership = await manager.getRepository(TenantMembership).findOneBy({
        tenantId: dto.tenantId, userId: dto.userId, status: 'active',
      });
      if (!membership) throw new BadRequestException('User is not an active member of this tenant');

      const project = await manager.getRepository(Project).findOneBy({ code: projectCode, status: 'active' });
      if (!project) throw new NotFoundException('Active project not found');

      const repository = manager.getRepository(UserProjectAccess);
      let access = await repository.findOneBy({
        tenantId: dto.tenantId, userId: dto.userId, projectCode,
      });
      if (access) {
        access.status = dto.status;
        access.entitlementVersion = String(Number(access.entitlementVersion) + 1);
      } else {
        access = repository.create({
          tenantId: dto.tenantId,
          userId: dto.userId,
          projectCode,
          status: dto.status,
          entitlementVersion: '1',
        });
      }
      const saved = await repository.save(access);
      await this.writeAudit(manager, principal, {
        tenantId: dto.tenantId,
        action: dto.status === 'granted' ? 'project_access.granted' : 'project_access.revoked',
        targetType: 'user_project_access',
        targetId: `${dto.userId}:${projectCode}`,
        details: {
          userId: dto.userId, projectCode, status: dto.status,
          entitlementVersion: saved.entitlementVersion,
        },
      });
      return {
        tenantId: saved.tenantId, userId: saved.userId,
        projectCode: saved.projectCode, status: saved.status,
        entitlementVersion: saved.entitlementVersion, updatedAt: saved.updatedAt,
      };
    });
  }

  private async writeAudit(
    manager: EntityManager,
    principal: JWTPayload,
    input: {
      tenantId: string | null;
      action: string;
      targetType: string;
      targetId: string;
      details: Record<string, unknown>;
    },
  ): Promise<void> {
    const actor = principal.iss && principal.sub
      ? await manager.getRepository(PlatformUser).findOneBy({
          oidcIssuer: principal.iss, oidcSubject: principal.sub,
        })
      : null;

    await manager.getRepository(AuditLog).save(manager.getRepository(AuditLog).create({
      tenantId: input.tenantId,
      actorUserId: actor?.id ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      correlationId: null,
      details: input.details,
    }));
  }
}
