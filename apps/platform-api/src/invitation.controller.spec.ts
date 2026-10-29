import { UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { JWTPayload } from 'jose';
import { InvitationController } from './invitation.controller';

describe('InvitationController identity binding', () => {
  const dataSource = {
    transaction: jest.fn(),
  } as unknown as DataSource;
  const controller = new InvitationController(dataSource);

  beforeEach(() => jest.clearAllMocks());

  it('rejects an OIDC identity without a verified email before database access', async () => {
    const principal = {
      iss: 'https://id.example.test/',
      sub: 'subject-123',
      email: 'member@example.com',
      email_verified: false,
    } as unknown as JWTPayload;

    await expect(controller.acceptInvitation({ token: 'long-enough-invitation-token' }, principal))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('rejects a verified email that does not match the invitation', async () => {
    const manager = {
      query: jest.fn().mockResolvedValue([{
        id: 'invitation-1',
        tenantId: '11111111-1111-4111-8111-111111111111',
        email: 'intended@example.com',
        displayName: 'Intended recipient',
        status: 'pending',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }]),
      getRepository: jest.fn(),
    } as unknown as EntityManager;
    (dataSource.transaction as jest.Mock).mockImplementation(
      async (callback: (manager: EntityManager) => Promise<unknown>) => callback(manager),
    );
    const principal = {
      iss: 'https://id.example.test/',
      sub: 'subject-123',
      email: 'different@example.com',
      email_verified: true,
    } as unknown as JWTPayload;

    await expect(controller.acceptInvitation({ token: 'long-enough-invitation-token' }, principal))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(manager.getRepository).not.toHaveBeenCalled();
  });
});
