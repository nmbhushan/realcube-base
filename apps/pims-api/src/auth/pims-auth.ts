import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { JWTPayload } from 'jose';
import type { Request } from 'express';

export const REQUIRED_PIMS_PERMISSION = 'realcube:pims:requiredPermission';

export interface PimsPrincipal {
  issuer: string;
  subject: string;
  tenantId: string;
  projectAccess: string[];
  permissions: string[];
}

export interface PimsAuthenticatedRequest extends Request {
  pimsPrincipal?: PimsPrincipal;
}

export const RequirePimsPermission = (permission: string) =>
  SetMetadata(REQUIRED_PIMS_PERMISSION, permission);

export const CurrentPimsPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PimsPrincipal | undefined => {
    const request = context.switchToHttp().getRequest<PimsAuthenticatedRequest>();
    return request.pimsPrincipal;
  },
);

export function readStringArrayClaim(payload: JWTPayload, claimName: string): string[] {
  const value = payload[claimName];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}
