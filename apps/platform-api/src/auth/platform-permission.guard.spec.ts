import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Reflector } from '@nestjs/core';
import { PlatformPermissionGuard } from './platform-permission.guard';
import { BOOTSTRAP_ROUTE_KEY, REQUIRED_PERMISSION_KEY } from './auth.decorators';

describe('PlatformPermissionGuard', () => {
  const handler = {};
  const controller = {};
  let reflector: { getAllAndOverride: jest.Mock };
  let dataSource: { query: jest.Mock };
  let request: { user?: { iss?: string; sub?: string } };
  let guard: PlatformPermissionGuard;

  const context = () => ({
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  });

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    dataSource = { query: jest.fn() };
    request = { user: { iss: 'https://id.example.test/', sub: 'user-123' } };
    guard = new PlatformPermissionGuard(reflector as unknown as Reflector, dataSource as unknown as DataSource);
    reflector.getAllAndOverride.mockImplementation((key: string) => {
      if (key === BOOTSTRAP_ROUTE_KEY) return false;
      if (key === REQUIRED_PERMISSION_KEY) return 'platform:admin';
      return undefined;
    });
  });

  it('allows routes that do not declare a permission', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await expect(guard.canActivate(context() as never)).resolves.toBe(true);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('allows an active administrator grant stored in the database', async () => {
    dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
    await expect(guard.canActivate(context() as never)).resolves.toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith(expect.stringContaining('platform_admin_grants'), [
      'https://id.example.test/', 'user-123', 'platform:admin',
    ]);
  });

  it('denies a token without an active database admin grant', async () => {
    dataSource.query.mockResolvedValue([]);
    await expect(guard.canActivate(context() as never)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a missing validated principal', async () => {
    request = {};
    await expect(guard.canActivate(context() as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('skips the database-admin check on the bootstrap route only', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => key === BOOTSTRAP_ROUTE_KEY);
    await expect(guard.canActivate(context() as never)).resolves.toBe(true);
    expect(dataSource.query).not.toHaveBeenCalled();
  });
});
