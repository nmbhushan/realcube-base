import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { PimsAuthenticatedRequest, PimsPrincipal, readStringArrayClaim } from './pims-auth';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class OidcAccessGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const issuer = process.env.OIDC_ISSUER_URL;
    const audience = process.env.PIMS_OIDC_AUDIENCE ?? 'pims-api';
    const jwksUrl = process.env.OIDC_JWKS_URL;

    if (!issuer || !audience || !jwksUrl) {
      throw new ServiceUnavailableException('PIMS OIDC authentication is not configured');
    }

    const maxTokenAgeSeconds = Number(process.env.PIMS_MAX_TOKEN_AGE_SECONDS ?? '300');
    if (!Number.isInteger(maxTokenAgeSeconds) || maxTokenAgeSeconds < 1 || maxTokenAgeSeconds > 300) {
      throw new ServiceUnavailableException('PIMS_MAX_TOKEN_AGE_SECONDS must be between 1 and 300');
    }

    const request = context.switchToHttp().getRequest<PimsAuthenticatedRequest>();
    const match = request.headers.authorization?.match(/^Bearer\\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('Bearer access token required');

    let payload: JWTPayload;
    try {
      this.jwks ??= createRemoteJWKSet(new URL(jwksUrl));
      ({ payload } = await jwtVerify(match[1], this.jwks, {
        issuer,
        audience,
        algorithms: ['RS256', 'RS384', 'RS512', 'ES256'],
        maxTokenAge: `${maxTokenAgeSeconds}s`,
        clockTolerance: 5,
      }));
    } catch {
      throw new UnauthorizedException('Invalid, expired, or too-old access token');
    }

    if (typeof payload.iss !== 'string' || typeof payload.sub !== 'string' || !payload.sub) {
      throw new UnauthorizedException('Validated token issuer and subject are required');
    }

    const tenantId = payload['tenant_id'];
    if (typeof tenantId !== 'string' || !UUID_PATTERN.test(tenantId)) {
      throw new ForbiddenException('A verified active tenant context is required');
    }

    const projectAccess = readStringArrayClaim(payload, 'project_access');
    if (!projectAccess.includes('PIMS')) {
      throw new ForbiddenException('PIMS project entitlement is required');
    }

    const permissionsClaim = process.env.PIMS_PERMISSIONS_CLAIM ?? 'permissions';
    const permissions = readStringArrayClaim(payload, permissionsClaim);
    const principal: PimsPrincipal = {
      issuer: payload.iss,
      subject: payload.sub,
      tenantId,
      projectAccess,
      permissions,
    };
    request.pimsPrincipal = principal;
    return true;
  }
}
