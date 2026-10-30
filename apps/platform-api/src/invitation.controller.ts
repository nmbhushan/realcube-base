import {
  BadRequestException, ConflictException, Controller, Body, Post, UnauthorizedException,
} from '@nestjs/common';
import { IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Max, Min } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import type { JWTPayload } from 'jose';
import { DataSource, EntityManager } from 'typeorm';
import { CurrentPrincipal, RequirePermission } from './auth/auth.decorators';
import { AccessChangeOutbox, AuditLog, PlatformUser } from './entities';

class CreateInvitationDto {
  @IsUUID()
  tenantId!: string;

  @IsEmail() @MaxLength(320)
  email!: string;

  @IsOptional() @IsString() @MaxLength(200)
  displayName?: string;

  @IsOptional() @IsInt() @Min(1) @Max(14)
  expiresInDays?: number;
}

class AcceptInvitationDto {
  @IsString() @IsNotEmpty() @MaxLength(128)
  token!: string;
}

@Controller()
export class InvitationController {
  constructor(private readonly dataSource: DataSource) {}

  @Post('admin/invitations')
  @RequirePermission('platform:admin')
  async createInvitation(
    @Body() dto: CreateInvitationDto,
    @CurrentPrincipal() principal: JWTPayload,
  ) {
    if (!principal.iss || !principal.sub) throw new UnauthorizedException('Validated identity is required');
    const email = dto.email.trim().toLowerCase();
    if (!email) throw new BadRequestException('Email cannot be blank');
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresInDays = dto.expiresInDays ?? 7;

    const invitation = await this.dataSource.transaction(async (manager) => {
      // Serialize invitation creation per tenant/email and normalize stale pending invitations.
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [dto.tenantId, email]);
      await manager.query(
        `UPDATE platform_user_invitations SET status = 'expired'
          WHERE tenant_id = $1 AND lower(email) = $2 AND status = 'pending' AND expires_at <= now()`,
        [dto.tenantId, email],
      );
      const tenants = await manager.query(
        "SELECT id FROM tenants WHERE id = $1 AND status = 'active' FOR SHARE",
        [dto.tenantId],
      );
      if (!tenants.length) throw new ConflictException('Active tenant not found');
      const duplicate = await manager.query(
        `SELECT i.id FROM platform_user_invitations i
          WHERE i.tenant_id = $1 AND lower(i.email) = $2
            AND i.status = 'pending' AND i.expires_at > now()
          LIMIT 1`,
        [dto.tenantId, email],
      );
      if (duplicate.length) throw new ConflictException('A pending invitation already exists for this email and tenant');

      const existingMembership = await manager.query(
        `SELECT u.id FROM users u
          JOIN tenant_users m ON m.user_id = u.id
         WHERE m.tenant_id = $1 AND lower(u.email) = $2
           AND u.status = 'active' AND m.status = 'active'
         LIMIT 1`,
        [dto.tenantId, email],
      );
      if (existingMembership.length) throw new ConflictException('This email already belongs to an active tenant member');

      const rows = await manager.query(
        `INSERT INTO platform_user_invitations
           (tenant_id, email, display_name, token_hash, status, invited_by_user_id, expires_at)
         VALUES ($1, $2, $3, $4, 'pending',
           (SELECT id FROM users WHERE oidc_issuer = $5 AND oidc_subject = $6),
           now() + ($7::int * interval '1 day'))
         RETURNING id, tenant_id AS "tenantId", email, display_name AS "displayName",
                   status, expires_at AS "expiresAt", created_at AS "createdAt"`,
        [dto.tenantId, email, dto.displayName?.trim() || null, tokenHash, principal.iss, principal.sub, expiresInDays],
      );
      const row = rows[0];
      await this.writeAudit(manager, {
        principal, tenantId: dto.tenantId, action: 'user.invitation_created',
        targetType: 'platform_user_invitation', targetId: row.id,
        details: { invitationId: row.id, email, expiresAt: row.expiresAt },
      });
      await this.writeOutbox(manager, {
        eventType: 'platform.user_invited', aggregateType: 'platform_user_invitation',
        aggregateId: row.id, tenantId: dto.tenantId,
        payload: { invitationId: row.id, tenantId: dto.tenantId, email, expiresAt: row.expiresAt },
      });
      return row;
    });
    // Return the raw token once. Only its hash is retained by the database.
    return { ...invitation, token: rawToken };
  }

  @Post('invitations/accept')
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @CurrentPrincipal() principal: JWTPayload,
  ) {
    if (!principal.iss || !principal.sub) throw new UnauthorizedException('Validated OIDC issuer and subject are required');
    const email = typeof principal.email === 'string' ? principal.email.trim().toLowerCase() : '';
    if (!email || principal.email_verified !== true) {
      throw new UnauthorizedException('A verified email claim from the identity provider is required');
    }
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');

    const result = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT id, tenant_id AS "tenantId", email, display_name AS "displayName",
                status, expires_at AS "expiresAt"
           FROM platform_user_invitations
          WHERE token_hash = $1
          FOR UPDATE`,
        [tokenHash],
      );
      const invitation = rows[0];
      if (!invitation || invitation.status !== 'pending') {
        throw new ConflictException('Invitation is invalid, expired, or already used');
      }
      if (new Date(invitation.expiresAt).getTime() <= Date.now()) {
        await manager.query("UPDATE platform_user_invitations SET status = 'expired' WHERE id = $1", [invitation.id]);
        return { expired: true };
      }
      if (String(invitation.email).toLowerCase() !== email) {
        throw new UnauthorizedException('The signed-in verified email does not match this invitation');
      }

      const users = manager.getRepository(PlatformUser);
      let user = await users.findOneBy({ oidcIssuer: principal.iss, oidcSubject: principal.sub });
      if (user && user.status !== 'active') {
        throw new ConflictException('This identity is already registered but not active');
      }
      if (!user) {
        user = await users.save(users.create({
          oidcIssuer: principal.iss, oidcSubject: principal.sub,
          email, displayName: invitation.displayName ?? (typeof principal.name === 'string' ? principal.name : null),
          status: 'active',
        }));
      } else if (user.email && user.email.toLowerCase() !== email) {
        throw new ConflictException('The signed-in identity is already mapped to a different email');
      }

      const memberships = await manager.query(
        'SELECT status FROM tenant_users WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE',
        [invitation.tenantId, user.id],
      );
      if (memberships[0]?.status === 'active') {
        throw new ConflictException('This identity is already an active member of the invited tenant');
      }
      const membershipRows = await manager.query(
        `INSERT INTO tenant_users (tenant_id, user_id, status)
         VALUES ($1, $2, 'active')
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET status = 'active', membership_version = tenant_users.membership_version + 1
         RETURNING membership_version`,
        [invitation.tenantId, user.id],
      );
      const membershipVersion = String(membershipRows[0].membership_version);
      await manager.query(
        `UPDATE platform_user_invitations
            SET status = 'accepted', accepted_by_user_id = $2, accepted_at = now()
          WHERE id = $1 AND status = 'pending'`,
        [invitation.id, user.id],
      );
      await this.writeAudit(manager, {
        principal, tenantId: invitation.tenantId, action: 'user.invitation_accepted',
        targetType: 'platform_user_invitation', targetId: invitation.id,
        details: { invitationId: invitation.id, userId: user.id },
      });
      await this.writeOutbox(manager, {
        eventType: 'platform.tenant_membership.activated', aggregateType: 'tenant_membership',
        aggregateId: `${invitation.tenantId}:${user.id}`, tenantId: invitation.tenantId,
        payload: { tenantId: invitation.tenantId, userId: user.id, invitationId: invitation.id,
          status: 'active', membershipVersion, oidcIssuer: user.oidcIssuer, oidcSubject: user.oidcSubject },
      });
      return { expired: false, status: 'accepted', userId: user.id, tenantId: invitation.tenantId };
    });
    if (result.expired) throw new ConflictException('Invitation has expired');
    return result;
  }

  private async writeAudit(
    manager: EntityManager,
    input: { principal: JWTPayload; tenantId: string; action: string; targetType: string; targetId: string; details: Record<string, unknown> },
  ): Promise<void> {
    const principal = input.principal;
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
