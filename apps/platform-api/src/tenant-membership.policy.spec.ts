import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { assertActiveTenantMembership } from './tenant-membership.policy';
import { TenantMembership } from './entities';

describe('assertActiveTenantMembership', () => {
  const findOneBy = jest.fn();
  const manager = {
    getRepository: jest.fn().mockReturnValue({ findOneBy }),
  } as unknown as EntityManager;

  beforeEach(() => findOneBy.mockReset());

  it('queries membership by the exact tenant, user and active status', async () => {
    findOneBy.mockResolvedValue({ tenantId: 'tenant-a', userId: 'user-a', status: 'active' });
    await expect(assertActiveTenantMembership(manager, 'tenant-a', 'user-a')).resolves.toBeUndefined();
    expect(manager.getRepository).toHaveBeenCalledWith(TenantMembership);
    expect(findOneBy).toHaveBeenCalledWith({
      tenantId: 'tenant-a', userId: 'user-a', status: 'active',
    });
  });

  it('rejects a user who has no active membership in the requested tenant', async () => {
    // Even if the user belongs to another tenant, the exact composite query returns no row.
    findOneBy.mockResolvedValue(null);
    await expect(assertActiveTenantMembership(manager, 'tenant-b', 'user-a'))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(findOneBy).toHaveBeenCalledWith({
      tenantId: 'tenant-b', userId: 'user-a', status: 'active',
    });
  });
});
