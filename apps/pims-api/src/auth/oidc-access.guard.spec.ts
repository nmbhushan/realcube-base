import { ExecutionContext, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { OidcAccessGuard } from './oidc-access.guard';

function makeContext(authorization?: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: authorization ? { authorization } : {} }) }),
  } as unknown as ExecutionContext;
}

describe('OidcAccessGuard', () => {
  const prior = {
    issuer: process.env.OIDC_ISSUER_URL,
    jwks: process.env.OIDC_JWKS_URL,
    audience: process.env.PIMS_OIDC_AUDIENCE,
    maxAge: process.env.PIMS_MAX_TOKEN_AGE_SECONDS,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries({
      OIDC_ISSUER_URL: prior.issuer,
      OIDC_JWKS_URL: prior.jwks,
      PIMS_OIDC_AUDIENCE: prior.audience,
      PIMS_MAX_TOKEN_AGE_SECONDS: prior.maxAge,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('fails closed when OIDC configuration is missing', async () => {
    delete process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_JWKS_URL;
    await expect(new OidcAccessGuard().canActivate(makeContext('Bearer token')))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects protected requests without a bearer token', async () => {
    process.env.OIDC_ISSUER_URL = 'https://issuer.example.test/';
    process.env.OIDC_JWKS_URL = 'https://issuer.example.test/.well-known/jwks.json';
    process.env.PIMS_OIDC_AUDIENCE = 'pims-api';
    await expect(new OidcAccessGuard().canActivate(makeContext()))
      .rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an unsafe token-age setting', async () => {
    process.env.OIDC_ISSUER_URL = 'https://issuer.example.test/';
    process.env.OIDC_JWKS_URL = 'https://issuer.example.test/.well-known/jwks.json';
    process.env.PIMS_OIDC_AUDIENCE = 'pims-api';
    process.env.PIMS_MAX_TOKEN_AGE_SECONDS = '3600';
    await expect(new OidcAccessGuard().canActivate(makeContext('Bearer token')))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
