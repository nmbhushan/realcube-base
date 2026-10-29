import {
  ConflictException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BootstrapController } from './bootstrap.controller';
import { AccessChangeOutbox, AuditLog, PlatformAdminGrant, PlatformUser } from './entities';

describe('BootstrapController', () => {
  const secret = 'local-test-secret-that-is-longer-than-32-characters';
  let controller: BootstrapController;
  let dataSource: { transaction: jest.Mock };
  let manager: {
    query: jest.Mock;
    getRepository: jest.Mock;
  };
  let userRepo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let grantRepo: { findOneBy: jest.Mock; create: jest.Mock; save: jest.Mock };
  let genericRepo: { create: jest.Mock; save: jest.Mock };

  const principal = {
    iss: 'https://id.example.test/',
    sub: 'oidc-sub-123',
    email: 'admin@example.test',
    name: 'First Admin',
  };

  const resetEnv = () => {
    delete process.env.PLATFORM_BOOTSTRAP_ENABLED;
    delete process.env.PLATFORM_BOOTSTRAP_SECRET;
  };

  beforeEach(() => {
    resetEnv();
    process.env.PLATFORM_BOOTSTRAP_ENABLED = 'true';
    process.env.PLATFORM_BOOTSTRAP_SECRET = secret;

    userRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'user-1', ...value })),
    };
    grantRepo = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => ({ id: 'grant-1', ...value })),
    };
    genericRepo = {
      create: jest.fn((value) => value),
      save: jest.fn(async (value) => value),
    };
    manager = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('platform_bootstrap_state WHERE')) return [{ id: 1, completed_at: null }];
        if (sql.includes('count(*)::int')) return [{ count: 0 }];
        if (sql.includes('UPDATE platform_bootstrap_state')) return [{ completed_at: '2026-10-29T00:00:00Z' }];
        return [];
      }),
      getRepository: jest.fn((entity) => {
        if (entity === PlatformUser) return userRepo;
        if (entity === PlatformAdminGrant) return grantRepo;
        if (entity === AuditLog || entity === AccessChangeOutbox) return genericRepo;
        throw new Error('Unexpected repository');
      }),
    };
    dataSource = { transaction: jest.fn((work: (manager: EntityManager) => unknown) => work(manager as unknown as EntityManager)) };
    controller = new BootstrapController(dataSource as unknown as DataSource);
  });

  afterAll(resetEnv);

  it('creates the first database-managed admin and marks bootstrap complete', async () => {
    const result = await controller.bootstrapFirstPlatformAdmin(secret, principal as never);
    expect(result).toMatchObject({ status: 'bootstrapped', userId: 'user-1', permission: 'platform:admin' });
    expect(grantRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      permissionCode: 'platform:admin',
      status: 'active',
    }));
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'));
    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE platform_bootstrap_state'), ['user-1']);
    expect(genericRepo.save).toHaveBeenCalledTimes(2); // audit + durable outbox record
  });

  it('rejects a wrong bootstrap secret without opening a transaction', async () => {
    await expect(controller.bootstrapFirstPlatformAdmin('wrong-secret', principal as never))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects when bootstrap is disabled', async () => {
    process.env.PLATFORM_BOOTSTRAP_ENABLED = 'false';
    await expect(controller.bootstrapFirstPlatformAdmin(secret, principal as never))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('prevents a second bootstrap after completion', async () => {
    manager.query.mockImplementation(async (sql: string) => {
      if (sql.includes('platform_bootstrap_state WHERE')) return [{ id: 1, completed_at: 'already-done' }];
      return [];
    });
    await expect(controller.bootstrapFirstPlatformAdmin(secret, principal as never))
      .rejects.toBeInstanceOf(ConflictException);
    expect(grantRepo.save).not.toHaveBeenCalled();
  });
});
