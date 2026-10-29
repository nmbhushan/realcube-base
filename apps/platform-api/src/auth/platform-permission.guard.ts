import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Reflector } from '@nestjs/core';
import {
  AuthenticatedRequest,
  BOOTSTRAP_ROUTE_KEY,
  REQUIRED_PERMISSION_KEY,
} from './auth.decorators';

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // This only skips the database-admin check. OidcAccessGuard still authenticates the caller.
    const isBootstrap = this.reflector.getAllAndOverride<boolean>(BOOTSTRAP_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isBootstrap) return true;

    const required = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = request.user;
    if (!principal?.iss || !principal.sub) {
      throw new UnauthorizedException('Validated identity is required');
    }

    if (required === 'platform:admin') {
      const rows = await this.dataSource.query(
        `SELECT 1
           FROM users u
           JOIN platform_admin_grants g ON g.user_id = u.id
          WHERE u.oidc_issuer = $1
            AND u.oidc_subject = $2
            AND u.status = 'active'
            AND g.permission_code = $3
            AND g.status = 'active'
          LIMIT 1`,
        [principal.iss, principal.sub, required],
      );
      if (rows.length > 0) return true;
      throw new ForbiddenException('Active Platform administrator grant required');
    }

    // Other Platform permissions must be implemented with an explicit, reviewed policy.
    // Do not fall back to untrusted request fields or frontend role state.
    throw new ForbiddenException(`Unsupported Platform permission: ${required}`);
  }
}
