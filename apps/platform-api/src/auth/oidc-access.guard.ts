import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import {
  AuthenticatedRequest,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSION_KEY,
} from './auth.decorators';

@Injectable()
export class OidcAccessGuard implements CanActivate {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Keep issuer exact; OIDC issuer identifiers are string-compared by the JWT verifier.
    const issuer = process.env.OIDC_ISSUER_URL;
    const audience = process.env.OIDC_AUDIENCE;
    const jwksUrl = process.env.OIDC_JWKS_URL;
    if (!issuer || !audience || !jwksUrl) {
      throw new ServiceUnavailableException('OIDC authentication is not configured');
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const match = request.headers.authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match) throw new UnauthorizedException('Bearer access token required');

    let payload: JWTPayload;
    try {
      this.jwks ??= createRemoteJWKSet(new URL(jwksUrl));
      ({ payload } = await jwtVerify(match[1], this.jwks, {
        issuer,
        audience,
        algorithms: ['RS256', 'RS384', 'RS512', 'ES256'],
      }));
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!payload.sub) throw new UnauthorizedException('Token subject is required');
    request.user = payload;
    this.assertRequiredPermission(context, payload);
    return true;
  }

  private assertRequiredPermission(context: ExecutionContext, payload: JWTPayload): void {
    const required = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return;

    const claimName = process.env.OIDC_PERMISSIONS_CLAIM || 'permissions';
    const claim = payload[claimName];
    const permissions = Array.isArray(claim)
      ? claim.filter((value): value is string => typeof value === 'string')
      : typeof payload.scope === 'string'
        ? payload.scope.split(/\s+/)
        : [];

    if (!permissions.includes(required)) {
      throw new ForbiddenException('Missing required permission');
    }
  }
}
