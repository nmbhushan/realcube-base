import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { AuthenticatedRequest, IS_PUBLIC_KEY } from './auth.decorators';

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

    const issuer = process.env.OIDC_ISSUER_URL;
    const audience = process.env.OIDC_AUDIENCE;
    const jwksUrl = process.env.OIDC_JWKS_URL;
    if (!issuer || !audience || !jwksUrl) {
      // Fail closed. Protected routes cannot run until a trusted issuer is configured.
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

    if (!payload.sub || !payload.iss) {
      throw new UnauthorizedException('Token issuer and subject are required');
    }
    request.user = payload;
    return true;
  }
}
