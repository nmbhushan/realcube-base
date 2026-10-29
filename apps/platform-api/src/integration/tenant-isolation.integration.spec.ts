import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  AccessChangeOutbox, AuditLog, PlatformAdminGrant, PlatformUser,
  PlatformUserInvitation, Project, Tenant, TenantMembership, UserProjectAccess,
} from '../entities';
import { AdminController } from '../admin.controller';
import { PlatformAccessController } from '../platform-access.controller';

const databaseUrl = process.env.PLATFORM_TEST_DATABASE_URL;
const integrationDescribe = databaseUrl ? describe : describe.skip;

integrationDescribe('PostgreSQL Platform tenant isolation and revocation integration', () => {
  let dataSource: DataSource;
  let cleanupPool: Pool;
  let schemaName: string;
  let adminController: AdminController;
  let accessController: PlatformAccessController;
  let fixture: {
    tenantA: Tenant;
    tenantB: Tenant;
    admin: PlatformUser;
    memberA: PlatformUser;
    memberB: PlatformUser;
    memberAWithoutAccess: PlatformUser;
    roleA: string;
    roleB: string;
  };

  const principal = { iss: 'https://idp.integration.test/', sub: 'admin-actor' };

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('PLATFORM_TEST_DATABASE_URL is required');
    const parsed = new URL(databaseUrl);
    const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).toLowerCase();
    if (!databaseName.includes('test')) {
      throw new Error('Refusing to run integration tests unless the database name includes "test"');
    }

    schemaName = 'platform_it_' + randomBytes(6).toString('hex');
    cleanupPool = new Pool({ connectionString: databaseUrl, max: 1 });
    await cleanupPool.query('CREATE SCHEMA "' + schemaName + '"');

    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      schema: schemaName,
      entities: [
        AccessChangeOutbox, AuditLog, PlatformAdminGrant, PlatformUser,
        PlatformUserInvitation, Project, Tenant, TenantMembership, UserProjectAccess,
      ],
      synchronize: false,
      logging: false,
      extra: { max: 1, options: '-c search_path=' + schemaName + ',public' },
    });
    await dataSource.initialize();

    for (const migrationName of [
      '001_initial_schema.sql',
      '002_admin_bootstrap_outbox.sql',
      '003_platform_admin_workflows.sql',
    ]) {
      const migrationPath = path.resolve(process.cwd(), '../../database/platform', migrationName);
      await dataSource.query(await readFile(migrationPath, 'utf8'));
    }

    adminController = new AdminController(dataSource);
    accessController = new PlatformAccessController(dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (cleanupPool) {
      if (schemaName) await cleanupPool.query('DROP SCHEMA IF EXISTS "' + schemaName + '" CASCADE');
      await cleanupPool.end();
    }
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM access_change_outbox');
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM platform_admin_grants');
    await dataSource.query('DELETE FROM platform_user_invitations');
    await dataSource.query('DELETE FROM user_project_roles');
    await dataSource.query('DELETE FROM role_permissions');
    await dataSource.query('DELETE FROM roles');
    await dataSource.query('DELETE FROM user_project_access');
    await dataSource.query('DELETE FROM tenant_users');
    await dataSource.query('DELETE FROM users');
    await dataSource.query('DELETE FROM tenants');

    const tenantRepo = dataSource.getRepository(Tenant);
    fixture = {} as typeof fixture;
    fixture.tenantA = await tenantRepo.save(tenantRepo.create({
      externalKey: 'TENANT-A', name: 'Tenant A', status: 'active',
    }));
    fixture.tenantB = await tenantRepo.save(tenantRepo.create({
      externalKey: 'TENANT-B', name: 'Tenant B', status: 'active',
    }));

    const userRepo = dataSource.getRepository(PlatformUser);
    fixture.admin = await userRepo.save(userRepo.create({
      oidcIssuer: principal.iss, oidcSubject: principal.sub,
      email: 'admin@integration.test', displayName: 'Integration Admin', status: 'active',
    }));
    fixture.memberA = await userRepo.save(userRepo.create({
      oidcIssuer: principal.iss, oidcSubject: 'member-a',
      email: 'member-a@integration.test', displayName: 'Tenant A Member', status: 'active',
    }));
    fixture.memberB = await userRepo.save(userRepo.create({
      oidcIssuer: principal.iss, oidcSubject: 'member-b',
      email: 'member-b@integration.test', displayName: 'Tenant B Member', status: 'active',
    }));
    fixture.memberAWithoutAccess = await userRepo.save(userRepo.create({
      oidcIssuer: principal.iss, oidcSubject: 'member-a-no-access',
      email: 'member-a-no-access@integration.test', displayName: 'No Entitlement Member', status: 'active',
    }));

    const membershipRepo = dataSource.getRepository(TenantMembership);
    await membershipRepo.save([
      membershipRepo.create({ tenantId: fixture.tenantA.id, userId: fixture.memberA.id, status: 'active' }),
      membershipRepo.create({ tenantId: fixture.tenantA.id, userId: fixture.memberAWithoutAccess.id, status: 'active' }),
      membershipRepo.create({ tenantId: fixture.tenantB.id, userId: fixture.memberB.id, status: 'active' }),
    ]);

    const roleA = await dataSource.query(
      'INSERT INTO roles (tenant_id, project_code, code, name) VALUES ($1, $2, $3, $4) RETURNING id',
      [fixture.tenantA.id, 'PIMS', 'tenant-a-manager', 'Tenant A Manager'],
    );
    const roleB = await dataSource.query(
      'INSERT INTO roles (tenant_id, project_code, code, name) VALUES ($1, $2, $3, $4) RETURNING id',
      [fixture.tenantB.id, 'PIMS', 'tenant-b-manager', 'Tenant B Manager'],
    );
    fixture.roleA = roleA[0].id;
    fixture.roleB = roleB[0].id;

    for (const roleId of [fixture.roleA, fixture.roleB]) {
      await dataSource.query(
        'INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2)',
        [roleId, 'project:read'],
      );
    }

    await dataSource.query(
      'INSERT INTO user_project_access (tenant_id, user_id, project_code, status) VALUES ($1, $2, $3, $4)',
      [fixture.tenantA.id, fixture.memberA.id, 'PIMS', 'granted'],
    );
    await dataSource.query(
      'INSERT INTO user_project_access (tenant_id, user_id, project_code, status) VALUES ($1, $2, $3, $4)',
      [fixture.tenantB.id, fixture.memberB.id, 'PIMS', 'granted'],
    );
    await dataSource.query(
      'INSERT INTO user_project_roles (tenant_id, user_id, project_code, role_id) VALUES ($1, $2, $3, $4)',
      [fixture.tenantA.id, fixture.memberA.id, 'PIMS', fixture.roleA],
    );
    await dataSource.query(
      'INSERT INTO user_project_roles (tenant_id, user_id, project_code, role_id) VALUES ($1, $2, $3, $4)',
      [fixture.tenantB.id, fixture.memberB.id, 'PIMS', fixture.roleB],
    );
  });

  it('scopes entitlement, role and assignment reads to the requested tenant', async () => {
    const entitlements = await adminController.listEntitlements(fixture.tenantA.id);
    expect(entitlements).toHaveLength(1);
    expect(entitlements[0].userId).toBe(fixture.memberA.id);
    expect(entitlements.map((row: { email: string }) => row.email)).not.toContain('member-b@integration.test');

    const roles = await accessController.listRoles(fixture.tenantA.id, 'pims');
    expect(roles).toHaveLength(1);
    expect(roles[0].id).toBe(fixture.roleA);
    expect(roles[0].permissionCodes).toContain('project:read');

    const assignments = await accessController.listUserProjectRoles(fixture.tenantA.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].userId).toBe(fixture.memberA.id);
    expect(assignments[0].roleId).toBe(fixture.roleA);
  });

  it('rejects role assignment without an active project grant and prevents cross-tenant role IDs', async () => {
    await expect(accessController.setUserProjectRole({
      tenantId: fixture.tenantA.id,
      userId: fixture.memberAWithoutAccess.id,
      projectCode: 'PIMS',
      roleId: fixture.roleA,
      status: 'assigned',
    }, principal)).rejects.toBeInstanceOf(BadRequestException);

    await expect(accessController.setUserProjectRole({
      tenantId: fixture.tenantA.id,
      userId: fixture.memberA.id,
      projectCode: 'PIMS',
      roleId: fixture.roleB,
      status: 'assigned',
    }, principal)).rejects.toBeInstanceOf(NotFoundException);

    const after = await dataSource.query(
      'SELECT user_id FROM user_project_roles WHERE tenant_id = $1',
      [fixture.tenantA.id],
    );
    expect(after).toHaveLength(1);
    expect(after[0].user_id).toBe(fixture.memberA.id);
  });

  it('revokes project access transactionally, removes project roles, and writes audit plus outbox records', async () => {
    const result = await adminController.setProjectAccess({
      tenantId: fixture.tenantA.id,
      userId: fixture.memberA.id,
      projectCode: 'pims',
      status: 'revoked',
    }, principal);

    expect(result.status).toBe('revoked');
    expect(Number(result.entitlementVersion)).toBe(2);

    const assignments = await dataSource.query(
      'SELECT role_id FROM user_project_roles WHERE tenant_id = $1 AND user_id = $2 AND project_code = $3',
      [fixture.tenantA.id, fixture.memberA.id, 'PIMS'],
    );
    expect(assignments).toHaveLength(0);

    const auditRows = await dataSource.getRepository(AuditLog).find({
      where: { tenantId: fixture.tenantA.id },
    });
    expect(auditRows.map(row => row.action)).toEqual(expect.arrayContaining([
      'project_access.revoked', 'project_role.revoked_by_entitlement',
    ]));
    expect(auditRows.every(row => row.actorUserId === fixture.admin.id)).toBe(true);

    const eventRows = await dataSource.getRepository(AccessChangeOutbox).find({
      where: { tenantId: fixture.tenantA.id },
    });
    expect(eventRows.map(row => row.eventType)).toEqual(expect.arrayContaining([
      'platform.project_access.revoked', 'platform.project_role.revoked',
    ]));
  });
});
