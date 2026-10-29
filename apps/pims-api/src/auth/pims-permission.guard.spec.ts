import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PimsPermissionGuard } from './pims-permission.guard';

function makeContext(principal: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ pimsPrincipal: principal }) }),
  } as unknown as ExecutionContext;
}

describe('PimsPermissionGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue('pims:read'),
  } as unknown as Reflector;
  const guard = new PimsPermissionGuard(reflector);

  beforeEach(() => jest.clearAllMocks());

  it('rejects when a verified principal is absent', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(UnauthorizedException);
  });

  it('rejects a principal without the PIMS entitlement', () => {
    const principal = { issuer: 'issuer', subject: 'user', tenantId: 'tenant', projectAccess: [], permissions: ['pims:read'] };
    expect(() => guard.canActivate(makeContext(principal))).toThrow(ForbiddenException);
  });

  it('rejects a principal without the required permission', () => {
    const principal = { issuer: 'issuer', subject: 'user', tenantId: 'tenant', projectAccess: ['PIMS'], permissions: ['pims:write'] };
    expect(() => guard.canActivate(makeContext(principal))).toThrow(ForbiddenException);
  });

  it('allows the exact PIMS entitlement and permission', () => {
    const principal = { issuer: 'issuer', subject: 'user', tenantId: 'tenant', projectAccess: ['PIMS'], permissions: ['pims:read'] };
    expect(guard.canActivate(makeContext(principal))).toBe(true);
  });
});
