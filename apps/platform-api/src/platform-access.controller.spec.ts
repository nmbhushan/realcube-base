import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { JWTPayload } from 'jose';
import { PlatformAccessController } from './platform-access.controller';

describe('PlatformAccessController role scoping', () => {
  const dataSource = {
    query: jest.fn(),
    transaction: jest.fn(),
  } as unknown as DataSource;
  const controller = new PlatformAccessController(dataSource);

  beforeEach(() => jest.clearAllMocks());

  it('normalizes project scope before listing tenant roles', async () => {
    (dataSource.query as jest.Mock).mockResolvedValue([]);
    await controller.listRoles('11111111-1111-4111-8111-111111111111', 'pims');
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('r.tenant_id = $1 AND r.project_code = $2'), [
      '11111111-1111-4111-8111-111111111111',
      'PIMS',
    ]);
  });

  it('does not assign a role when project entitlement is missing or revoked', async () => {
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce([{ id: 'user-1' }])
        .mockResolvedValueOnce([{ status: 'revoked' }]),
      getRepository: jest.fn(),
    } as unknown as EntityManager;
    (dataSource.transaction as jest.Mock).mockImplementation(
      async (callback: (manager: EntityManager) => Promise<unknown>) => callback(manager),
    );
    const principal = { iss: 'https://id.example.test/', sub: 'admin-subject' } as JWTPayload;

    await expect(controller.setUserProjectRole({
      tenantId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      projectCode: 'PIMS',
      roleId: '33333333-3333-4333-8333-333333333333',
      status: 'assigned',
    }, principal)).rejects.toBeInstanceOf(BadRequestException);
    expect(manager.query).toHaveBeenCalledTimes(2);
  });
});
