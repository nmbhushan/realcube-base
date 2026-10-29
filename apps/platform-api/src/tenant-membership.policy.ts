import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { TenantMembership } from './entities';

export async function assertActiveTenantMembership(
  manager: EntityManager,
  tenantId: string,
  userId: string,
): Promise<void> {
  const membership = await manager.getRepository(TenantMembership).findOneBy({
    tenantId,
    userId,
    status: 'active',
  });
  if (!membership) {
    throw new BadRequestException('User is not an active member of this tenant');
  }
}
