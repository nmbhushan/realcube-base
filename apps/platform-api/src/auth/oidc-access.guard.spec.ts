import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OidcAccessGuard } from './oidc-access.guard';
import { IS_PUBLIC_KEY } from './auth.decorators';

describe('OidcAccessGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: OidcAccessGuard;
  let request: { headers: Record<string, string>; user?: unknown };

  const context = () => ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  });

  const restoreEnv = () => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_AUDIENCE;
    delete process.env.OIDC_JWKS_URL;
  };

  beforeEach(() => {
    restoreEnv();
    reflector = { getAllAndOverride: jest.fn() };
    request = { headers: {} };
    guard = new OidcAccessGuard(reflector as unknown as Reflector);
    reflector.getAllAndOverride.mockImplementation((key: string) => key === IS_PUBLIC_KEY ? false : undefined);
  });

  afterAll(restoreEnv);

  it('allows explicitly public health routes without OIDC configuration', async () => {
    reflector.getAllAndOverride.mockImplementation((key: string) => key === IS_PUBLIC_KEY);
    await expect(guard.canActivate(context() as never)).resolves.toBe(true);
  });

  it('fails closed when OIDC is not configured', async () => {
    await expect(guard.canActivate(context() as never)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects a missing Bearer token before attempting key retrieval', async () => {
    process.env.OIDC_ISSUER_URL = 'https://id.example.test/';
    process.env.OIDC_AUDIENCE = 'enterprise-platform-api';
    process.env.OIDC_JWKS_URL = 'https://id.example.test/.well-known/jwks.json';
    await expect(guard.canActivate(context() as never)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
