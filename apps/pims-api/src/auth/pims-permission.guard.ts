import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PimsAuthenticatedRequest, REQUIRED_PIMS_PERMISSION } from './pims-auth';

@Injectable()
export class PimsPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string>(REQUIRED_PIMS_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<PimsAuthenticatedRequest>();
    const principal = request.pimsPrincipal;
    if (!principal) throw new UnauthorizedException('Validated PIMS identity is required');
    if (!principal.projectAccess.includes('PIMS')) {
      throw new ForbiddenException('PIMS project entitlement is required');
    }
    if (!principal.permissions.includes(required)) {
      throw new ForbiddenException('Required PIMS permission is missing');
    }
    return true;
  }
}
