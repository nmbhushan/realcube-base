import 'reflect-metadata';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { OidcAccessGuard } from '../auth/oidc-access.guard';

describe('OIDC access guard with a real JWKS endpoint', () => {
  let server: Server;
  let issuer: string;
  let jwksUrl: string;
  let privateKey: KeyLike;
  let publicJwk: Awaited<ReturnType<typeof exportJWK>>;
  let guard: OidcAccessGuard;
  const previous = {
    issuer: process.env.OIDC_ISSUER_URL,
    jwks: process.env.OIDC_JWKS_URL,
    audience: process.env.OIDC_AUDIENCE,
  };

  beforeAll(async () => {
    const keys = await generateKeyPair('RS256', { modulusLength: 2048 });
    privateKey = keys.privateKey as KeyLike;
    publicJwk = await exportJWK(keys.publicKey);
    publicJwk.kid = 'integration-signing-key';
    publicJwk.alg = 'RS256';
    publicJwk.use = 'sig';

    server = createServer((request, response) => {
      if (request.url !== '/jwks') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=60',
      });
      response.end(JSON.stringify({ keys: [publicJwk] }));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = (server.address() as AddressInfo).port;
    issuer = 'http://127.0.0.1:' + port + '/issuer';
    jwksUrl = 'http://127.0.0.1:' + port + '/jwks';
    process.env.OIDC_ISSUER_URL = issuer;
    process.env.OIDC_JWKS_URL = jwksUrl;
    process.env.OIDC_AUDIENCE = 'enterprise-platform-api';

    const reflector = {
      getAllAndOverride: jest.fn(() => false),
    } as unknown as Reflector;
    guard = new OidcAccessGuard(reflector);
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    if (previous.issuer === undefined) delete process.env.OIDC_ISSUER_URL;
    else process.env.OIDC_ISSUER_URL = previous.issuer;
    if (previous.jwks === undefined) delete process.env.OIDC_JWKS_URL;
    else process.env.OIDC_JWKS_URL = previous.jwks;
    if (previous.audience === undefined) delete process.env.OIDC_AUDIENCE;
    else process.env.OIDC_AUDIENCE = previous.audience;
  });

  async function token(options: { audience?: string; issuer?: string; expired?: boolean; key?: KeyLike } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const jwt = new SignJWT({ scope: 'platform:admin' })
      .setProtectedHeader({ alg: 'RS256', kid: 'integration-signing-key', typ: 'JWT' })
      .setIssuer(options.issuer ?? issuer)
      .setAudience(options.audience ?? 'enterprise-platform-api')
      .setSubject('test-subject')
      .setIssuedAt(options.expired ? now - 3600 : now)
      .setExpirationTime(options.expired ? now - 30 : now + 300);
    return jwt.sign(options.key ?? privateKey);
  }

  function contextFor(authorization?: string) {
    const request: { headers: Record<string, string>; user?: Record<string, unknown> } = {
      headers: authorization ? { authorization } : {},
    };
    const context = {
      getHandler: () => function protectedHandler() {},
      getClass: () => class ProtectedController {},
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { context, request };
  }

  it('accepts a correctly signed, issuer- and audience-bound JWT', async () => {
    const generated = await token();
    const { context, request } = contextFor('Bearer ' + generated);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({
      iss: issuer, sub: 'test-subject', aud: 'enterprise-platform-api',
    });
  });

  it('rejects a different issuer, wrong audience, expired token and invalid signature', async () => {
    for (const options of [
      { issuer: 'http://wrong-issuer.example/' },
      { audience: 'some-other-api' },
      { expired: true },
    ]) {
      const { context } = contextFor('Bearer ' + await token(options));
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    }

    const other = await generateKeyPair('RS256', { modulusLength: 2048 });
    const { context } = contextFor('Bearer ' + await token({ key: other.privateKey as KeyLike }));
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed if the trusted issuer configuration is missing', async () => {
    const savedIssuer = process.env.OIDC_ISSUER_URL;
    delete process.env.OIDC_ISSUER_URL;
    const { context } = contextFor('Bearer some-token');
    try {
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ServiceUnavailableException);
    } finally {
      if (savedIssuer === undefined) delete process.env.OIDC_ISSUER_URL;
      else process.env.OIDC_ISSUER_URL = savedIssuer;
    }
  });

  it('rejects requests with no Bearer token', async () => {
    const { context } = contextFor();
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
