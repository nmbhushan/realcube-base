import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { JWTPayload } from 'jose';
import type { Request } from 'express';

export const IS_PUBLIC_KEY = 'enterpriseWorkspace:isPublic';
export const REQUIRED_PERMISSION_KEY = 'enterpriseWorkspace:requiredPermission';
export const BOOTSTRAP_ROUTE_KEY = 'enterpriseWorkspace:bootstrapRoute';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const BootstrapRoute = () => SetMetadata(BOOTSTRAP_ROUTE_KEY, true);
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);

export interface AuthenticatedRequest extends Request {
  user?: JWTPayload;
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): JWTPayload | undefined => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.user;
  },
);
