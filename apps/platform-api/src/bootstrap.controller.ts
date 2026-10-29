import {
  ConflictException,
  Controller,
  Headers,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { JWTPayload } from 'jose';
import { DataSource, EntityManager } from 'typeorm';
import { BootstrapRoute, CurrentPrincipal } from './auth/auth.decorators';
import { AccessChangeOutbox, AuditLog, PlatformAdminGrant, PlatformUser } from './entities';

@Controller('bootstrap')
export class BootstrapController {
  constructor(private readonly dataSource: DataSource) {}

  @Post('platform-admin')
  @BootstrapRoute()
  async bootstrapFirstPlatformAdmin(
    @Headers('x-platform-bootstrap-token') presentedSecret: string | undefined,
    @CurrentPrincipal() principal: JWTPayload,
  ) {
    this.assertBootstrapSecret(presentedSecret);
    if (!principal.iss || !principal.sub) {
      throw new UnauthorizedException('Validated OIDC issuer and subject are required');
    }

    return this.dataSource.transaction(async (manager) => {
      // Serialize bootstrap and admin grants/revocations so only one initial admin can be established.
      await manager.query('SELECT pg_advisory_xact_lock(19072026, 1)');
      const states = await manager.query(
        'SELECT id, completed_at FROM platform_bootstrap_state WHERE id = 1 FOR UPDATE',
      );
      if (!states.length) {
        throw new ServiceUnavailableException('Platform bootstrap migration has not been applied');
      }
      if (states[0].completed_at) {
        throw new ConflictException('Platform first-admin bootstrap has already been completed');
      }
      const existingAdmins = await manager.query(
        `SELECT count(*)::int AS count
           FROM platform_admin_grants g
           JOIN users u ON u.id = g.user_id
          WHERE g.permission_code = 'platform:admin'
            AND g.status = 'active' AND u.status = 'active'`,
      );
      if (Number(existingAdmins[0]?.count ?? 0) > 0) {
        throw new ConflictException('An active Platform administrator already exists; bootstrap is disabled');
      }

      const userRepository = manager.getRepository(PlatformUser);
      let user = await userRepository.findOneBy({
        oidcIssuer: principal.iss,
        oidcSubject: principal.sub,
      });
      if (user && user.status !== 'active') {
        throw new ConflictException('The OIDC identity already exists but is not active');
      }
      if (!user) {
        const email = typeof principal.email === 'string' ? principal.email.trim().toLowerCase() : null;
        const displayName = typeof principal.name === 'string' ? principal.name.trim() : null;
        user = await userRepository.save(userRepository.create({
          oidcIssuer: principal.iss,
          oidcSubject: principal.sub,
          email,
          displayName,
          status: 'active',
        }));
      }

      const grants = manager.getRepository(PlatformAdminGrant);
      const grant = await grants.save(grants.create({
        userId: user.id,
        permissionCode: 'platform:admin',
        status: 'active',
        reason: 'Initial one-time bootstrap',
        grantedByUserId: null,
        revokedAt: null,
      }));

      const bootstrapUpdate = await manager.query(
        `UPDATE platform_bootstrap_state
            SET completed_at = now(), completed_by_user_id = $1
          WHERE id = 1 AND completed_at IS NULL
          RETURNING completed_at`,
        [user.id],
      );
      if (!bootstrapUpdate.length) {
        throw new ConflictException('Platform bootstrap has already been claimed');
      }

      await manager.getRepository(AuditLog).save(manager.getRepository(AuditLog).create({
        tenantId: null,
        actorUserId: user.id,
        action: 'platform.admin_bootstrapped',
        targetType: 'platform_admin_grant',
        targetId: grant.id,
        correlationId: null,
        details: { userId: user.id, permissionCode: grant.permissionCode },
      }));
      await this.writeOutbox(manager, {
        eventType: 'platform.admin_granted',
        aggregateType: 'platform_user',
        aggregateId: user.id,
        tenantId: null,
        payload: {
          userId: user.id,
          permissionCode: grant.permissionCode,
          status: 'active',
          grantId: grant.id,
          reason: 'initial-bootstrap',
        },
      });

      return {
        status: 'bootstrapped',
        userId: user.id,
        permission: 'platform:admin',
        completedAt: bootstrapUpdate[0].completed_at,
      };
    });
  }

  private assertBootstrapSecret(presented: string | undefined): void {
    if (process.env.PLATFORM_BOOTSTRAP_ENABLED !== 'true') {
      throw new ServiceUnavailableException('Platform bootstrap is disabled');
    }
    const expected = process.env.PLATFORM_BOOTSTRAP_SECRET;
    if (!expected || expected.length < 32) {
      throw new ServiceUnavailableException('A bootstrap secret of at least 32 characters is required');
    }
    if (typeof presented !== 'string' || !presented) throw new UnauthorizedException('Bootstrap token required');
    const expectedBytes = Buffer.from(expected, 'utf8');
    const presentedBytes = Buffer.from(presented, 'utf8');
    if (expectedBytes.length !== presentedBytes.length ||
        !timingSafeEqual(expectedBytes, presentedBytes)) {
      throw new UnauthorizedException('Invalid bootstrap token');
    }
  }

  private async writeOutbox(
    manager: EntityManager,
    event: { eventType: string; aggregateType: string; aggregateId: string; tenantId: string | null; payload: Record<string, unknown> },
  ): Promise<void> {
    const repository = manager.getRepository(AccessChangeOutbox);
    await repository.save(repository.create(event));
  }
}
