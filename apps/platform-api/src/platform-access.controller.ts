import {
  BadRequestException, ConflictException, Controller, Get, NotFoundException,
  Post, Body, Query,
} from '@nestjs/common';
import {
  ArrayNotEmpty, ArrayUnique, IsArray, IsIn, IsNotEmpty, IsString, IsUUID,
  Matches, MaxLength,
} from 'class-validator';
import type { JWTPayload } from 'jose';
import { DataSource, EntityManager } from 'typeorm';
import { CurrentPrincipal, RequirePermission } from './auth/auth.decorators';
import { AccessChangeOutbox, AuditLog, PlatformUser } from './entities';

class CreateRoleDto {
  @IsUUID()
  tenantId!: string;

  @IsString() @IsNotEmpty() @MaxLength(32)
  projectCode!: string;

  @Matches(/^[a-z][a-z0-9_-]{1,63}$/)
  code!: string;

  @IsString() @IsNotEmpty() @MaxLength(100)
  name!: string;

  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissionCodes!: string[];
}

class SetUserProjectRoleDto {
  @IsUUID()
  tenantId!: string;

  @IsUUID()
  userId!: string;

  @IsString() @IsNotEmpty() @MaxLength(32)
  projectCode!: string;

  @IsUUID()
  roleId!: string;

  @IsIn(['assigned', 'revoked'])
  status!: 'assigned' | 'revoked';
}

@Controller('admin')
@RequirePermission('platform:admin')
export class PlatformAccessController {
  constructor(private readonly dataSource: DataSource) {}

  @Get('members')
  async listMembers(@Query('tenantId') tenantId: string) {
    this.assertUuid(tenantId, 'tenantId');
    return this.dataSource.query(
      `SELECT u.id, u.email, u.display_name AS "displayName", u.status AS "userStatus",
              m.status AS "membershipStatus", m.created_at AS "joinedAt"
         FROM tenant_users m
         JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = $1
        ORDER BY u.email NULLS LAST, u.created_at DESC`,
      [tenantId],
    );
  }

  @Get('permissions')
  async listPermissions() {
    return this.dataSource.query(
      'SELECT code, description FROM permissions ORDER BY code',
    );
  }

  @Get('roles')
  async listRoles(
    @Query('tenantId') tenantId: string,
    @Query('projectCode') projectCode: string,
  ) {
    this.assertUuid(tenantId, 'tenantId');
    const normalizedProject = this.normalizeProject(projectCode);
    return this.dataSource.query(
      `SELECT r.id, r.tenant_id AS "tenantId", r.project_code AS "projectCode",
              r.code, r.name,
              COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
                FILTER (WHERE rp.permission_code IS NOT NULL), ARRAY[]::text[]) AS "permissionCodes"
         FROM roles r
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE r.tenant_id = $1 AND r.project_code = $2
        GROUP BY r.id
        ORDER BY r.name`,
      [tenantId, normalizedProject],
    );
  }

  @Get('user-project-roles')
  async listUserProjectRoles(@Query('tenantId') tenantId: string) {
    this.assertUuid(tenantId, 'tenantId');
    return this.dataSource.query(
      `SELECT upr.tenant_id AS "tenantId", upr.user_id AS "userId",
              u.email, u.display_name AS "displayName",
              upr.project_code AS "projectCode", r.id AS "roleId",
              r.code AS "roleCode", r.name AS "roleName",
              COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
                FILTER (WHERE rp.permission_code IS NOT NULL), ARRAY[]::text[]) AS "permissionCodes"
         FROM user_project_roles upr
         JOIN users u ON u.id = upr.user_id
         JOIN roles r ON r.id = upr.role_id
         LEFT JOIN role_permissions rp ON rp.role_id = r.id
        WHERE upr.tenant_id = $1
        GROUP BY upr.tenant_id, upr.user_id, u.email, u.display_name,
                 upr.project_code, r.id, r.code, r.name
        ORDER BY u.email, upr.project_code, r.name`,
      [tenantId],
    );
  }

  @Post('roles')
  async createRole(@Body() dto: CreateRoleDto, @CurrentPrincipal() principal: JWTPayload) {
    const projectCode = this.normalizeProject(dto.projectCode);
    const code = dto.code.trim().toLowerCase();
    const name = dto.name.trim();
    const permissionCodes = [...new Set(dto.permissionCodes.map((code) => code.trim()))];
    if (!code || !name || permissionCodes.some((value) => !value)) {
      throw new BadRequestException('Role code, name, and permissions cannot be blank');
    }

    return this.dataSource.transaction(async (manager) => {
      const tenantRows = await manager.query(
        "SELECT id FROM tenants WHERE id = $1 AND status = 'active' FOR SHARE", [dto.tenantId],
      );
      if (!tenantRows.length) throw new NotFoundException('Active tenant not found');
      const projectRows = await manager.query(
        "SELECT code FROM projects WHERE code = $1 AND status = 'active' FOR SHARE", [projectCode],
      );
      if (!projectRows.length) throw new NotFoundException('Active project not found');

      const existing = await manager.query(
        'SELECT id FROM roles WHERE tenant_id = $1 AND project_code = $2 AND code = $3 LIMIT 1',
        [dto.tenantId, projectCode, code],
      );
      if (existing.length) throw new ConflictException('Role code already exists for this tenant and project');

      const permissions = await manager.query(
        'SELECT code FROM permissions WHERE code = ANY($1::text[]) ORDER BY code',
        [permissionCodes],
      );
      if (permissions.length !== permissionCodes.length) {
        const found = new Set(permissions.map((permission: { code: string }) => permission.code));
        throw new BadRequestException({
          message: 'One or more permission codes are unknown',
          unknownPermissionCodes: permissionCodes.filter((permission) => !found.has(permission)),
        });
      }

      const rows = await manager.query(
        `INSERT INTO roles (tenant_id, project_code, code, name)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tenant_id AS "tenantId", project_code AS "projectCode", code, name`,
        [dto.tenantId, projectCode, code, name],
      );
      const role = rows[0];
      for (const permissionCode of permissionCodes) {
        await manager.query(
          'INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2)',
          [role.id, permissionCode],
        );
      }
      await this.writeAudit(manager, principal, {
        tenantId: dto.tenantId, action: 'role.created', targetType: 'role',
        targetId: role.id, details: { projectCode, code, permissionCodes },
      });
      await this.writeOutbox(manager, {
        eventType: 'platform.role.created', aggregateType: 'role', aggregateId: role.id,
        tenantId: dto.tenantId, payload: { ...role, permissionCodes },
      });
      return { ...role, permissionCodes };
    });
  }

  @Post('user-project-roles')
  async setUserProjectRole(
    @Body() dto: SetUserProjectRoleDto,
    @CurrentPrincipal() principal: JWTPayload,
  ) {
    const projectCode = this.normalizeProject(dto.projectCode);
    return this.dataSource.transaction(async (manager) => {
      const userRows = await manager.query(
        `SELECT u.id
           FROM users u
           JOIN tenant_users m ON m.user_id = u.id AND m.tenant_id = $1 AND m.status = 'active'
          WHERE u.id = $2 AND u.status = 'active'`,
        [dto.tenantId, dto.userId],
      );
      if (!userRows.length) throw new NotFoundException('Active tenant member not found');

      const accessRows = await manager.query(
        `SELECT status FROM user_project_access
          WHERE tenant_id = $1 AND user_id = $2 AND project_code = $3
          FOR UPDATE`,
        [dto.tenantId, dto.userId, projectCode],
      );
      if (dto.status === 'assigned' && accessRows[0]?.status !== 'granted') {
        throw new BadRequestException('Project access must be granted before assigning a role');
      }
      const roleRows = await manager.query(
        `SELECT id, tenant_id, project_code, code, name
           FROM roles WHERE id = $1 AND tenant_id = $2 AND project_code = $3`,
        [dto.roleId, dto.tenantId, projectCode],
      );
      if (!roleRows.length) throw new NotFoundException('Role not found for this tenant and project');

      if (dto.status === 'assigned') {
        const result = await manager.query(
          `INSERT INTO user_project_roles (tenant_id, user_id, project_code, role_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING
           RETURNING role_id`,
          [dto.tenantId, dto.userId, projectCode, dto.roleId],
        );
        if (!result.length) return { status: 'assigned', alreadyAssigned: true, roleId: dto.roleId };
      } else {
        const result = await manager.query(
          `DELETE FROM user_project_roles
            WHERE tenant_id = $1 AND user_id = $2 AND project_code = $3 AND role_id = $4
            RETURNING role_id`,
          [dto.tenantId, dto.userId, projectCode, dto.roleId],
        );
        if (!result.length) throw new NotFoundException('Role assignment not found');
      }

      const details = {
        userId: dto.userId, projectCode, roleId: dto.roleId,
        roleCode: roleRows[0].code, status: dto.status,
      };
      await this.writeAudit(manager, principal, {
        tenantId: dto.tenantId,
        action: dto.status === 'assigned' ? 'project_role.assigned' : 'project_role.revoked',
        targetType: 'user_project_role',
        targetId: `${dto.userId}:${projectCode}:${dto.roleId}`,
        details,
      });
      await this.writeOutbox(manager, {
        eventType: dto.status === 'assigned' ? 'platform.project_role.assigned' : 'platform.project_role.revoked',
        aggregateType: 'user_project_role',
        aggregateId: `${dto.tenantId}:${dto.userId}:${projectCode}:${dto.roleId}`,
        tenantId: dto.tenantId,
        payload: details,
      });
      return details;
    });
  }

  private normalizeProject(code: string): string {
    const normalized = (code ?? '').trim().toUpperCase();
    if (!normalized || normalized.length > 32) throw new BadRequestException('A valid projectCode is required');
    return normalized;
  }

  private assertUuid(value: string, name: string): void {
    if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new BadRequestException(`A valid ${name} UUID is required`);
    }
  }

  private async writeAudit(
    manager: EntityManager, principal: JWTPayload,
    input: { tenantId: string | null; action: string; targetType: string; targetId: string; details: Record<string, unknown> },
  ): Promise<void> {
    const actor = principal.iss && principal.sub
      ? await manager.getRepository(PlatformUser).findOneBy({ oidcIssuer: principal.iss, oidcSubject: principal.sub })
      : null;
    const repository = manager.getRepository(AuditLog);
    await repository.save(repository.create({
      tenantId: input.tenantId, actorUserId: actor?.id ?? null, action: input.action,
      targetType: input.targetType, targetId: input.targetId, correlationId: null, details: input.details,
    }));
  }

  private async writeOutbox(
    manager: EntityManager,
    input: { eventType: string; aggregateType: string; aggregateId: string; tenantId: string | null; payload: Record<string, unknown> },
  ): Promise<void> {
    const repository = manager.getRepository(AccessChangeOutbox);
    await repository.save(repository.create(input));
  }
}
