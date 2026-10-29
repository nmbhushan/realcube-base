import { createHash, createServer, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as login } from '../app/api/auth/login/route';
import { GET as callback } from '../app/api/auth/callback/route';
import { GET as sessionStatus } from '../app/api/auth/session/route';
import { POST as logout } from '../app/api/auth/logout/route';

const fakeRedis = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  counters: new Map<string, number>(),
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => ({
    isOpen: true,
    on: vi.fn(),
    connect: vi.fn(async () => undefined),
    get: vi.fn(async (key: string) => fakeRedis.entries.get(key) ?? null),
    getDel: vi.fn(async (key: string) => {
      const value = fakeRedis.entries.get(key) ?? null;
      fakeRedis.entries.delete(key);
      return value;
    }),
    set: vi.fn(async (key: string, value: string, options?: { NX?: boolean; EX?: number }) => {
      if (options?.NX && fakeRedis.entries.has(key)) return null;
      fakeRedis.entries.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (...keys: string[]) => {
      let removed = 0;
      for (const key of keys) if (fakeRedis.entries.delete(key)) removed += 1;
      return removed;
    }),
    eval: vi.fn(async (script: string, options: { keys: string[]; arguments: string[] }) => {
      const key = options.keys[0];
      if (script.includes("redis.call('INCR'")) {
        const count = (fakeRedis.counters.get(key) ?? 0) + 1;
        fakeRedis.counters.set(key, count);
        return [count, Number(options.arguments[0])];
      }
      if (script.includes("redis.call('get', KEYS[1])")) {
        if (fakeRedis.entries.get(key) === options.arguments[0]) {
          fakeRedis.entries.delete(key);
          return 1;
        }
        return 0;
      }
      return 0;
    }),
  })),
}));

type AuthorizationCode = {
  redirectUri: string;
  challenge: string;
  nonce: string;
  clientId: string;
  used: boolean;
};

type ProviderCounters = {
  authorizationRequests: number;
  codeExchanges: number;
  refreshRequests: number;
  logoutRequests: number;
};

const CLIENT_ID = 'realcube-platform-web-test';
const CLIENT_SECRET = 'local-only-test-secret';
const API_AUDIENCE = 'enterprise-platform-api';
const callbackOrigin = 'http://localhost:3000';
const sessionCookieName = 'rc_session';
const transactionCookieName = 'rc_oidc_tx';

let provider: Server;
let issuer = '';
let privateSigningKey: KeyObject;
let publicJwk: Record<string, unknown>;
const authorizationCodes = new Map<string, AuthorizationCode>();
const counters: ProviderCounters = {
  authorizationRequests: 0,
  codeExchanges: 0,
  refreshRequests: 0,
  logoutRequests: 0,
};

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
    pragma: 'no-cache',
  });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const parts: Buffer[] = [];
  for await (const chunk of request) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(parts).toString('utf8');
}

function signJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'realcube-e2e-key' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = header + '.' + payload;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  signer.end();
  return input + '.' + signer.sign(privateSigningKey).toString('base64url');
}

function signedIdentityToken(nonce?: string): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: issuer,
    aud: CLIENT_ID,
    sub: 'oidc-e2e-user-001',
    iat: now,
    exp: now + 600,
    ...(nonce ? { nonce } : {}),
    email: 'oidc-e2e-user@example.test',
    email_verified: true,
    name: 'RealCube Integration User',
  });
}

function signedAccessToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({
    iss: issuer,
    aud: API_AUDIENCE,
    sub: 'oidc-e2e-user-001',
    iat: now,
    exp: now + 600,
    email: 'oidc-e2e-user@example.test',
    email_verified: true,
    scope: 'openid email profile',
  });
}

function sendProviderError(response: ServerResponse, status: number, error: string): void {
  writeJson(response, status, { error });
}

async function handleProviderRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', issuer);

  if (request.method === 'GET' && requestUrl.pathname === '/.well-known/openid-configuration') {
    writeJson(response, 200, {
      issuer,
      authorization_endpoint: issuer + '/authorize',
      token_endpoint: issuer + '/token',
      jwks_uri: issuer + '/jwks',
      end_session_endpoint: issuer + '/logout',
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
    });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/jwks') {
    writeJson(response, 200, { keys: [publicJwk] });
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/authorize') {
    const redirectUri = requestUrl.searchParams.get('redirect_uri');
    const state = requestUrl.searchParams.get('state');
    const clientId = requestUrl.searchParams.get('client_id');
    const nonce = requestUrl.searchParams.get('nonce');
    const challenge = requestUrl.searchParams.get('code_challenge');
    if (!redirectUri || !state || clientId !== CLIENT_ID || !nonce || !challenge ||
        requestUrl.searchParams.get('code_challenge_method') !== 'S256') {
      sendProviderError(response, 400, 'invalid_authorization_request');
      return;
    }
    counters.authorizationRequests += 1;
    const code = 'code-' + cryptoRandomId();
    authorizationCodes.set(code, {
      redirectUri,
      challenge,
      nonce,
      clientId,
      used: false,
    });
    const destination = new URL(redirectUri);
    destination.searchParams.set('code', code);
    destination.searchParams.set('state', state);
    response.writeHead(302, { location: destination.toString(), 'cache-control': 'no-store' });
    response.end();
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/token') {
    const form = new URLSearchParams(await readBody(request));
    const authHeader = request.headers.authorization ?? '';
    let suppliedClientId = form.get('client_id') ?? '';
    let suppliedClientSecret = form.get('client_secret') ?? '';
    if (authHeader.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      suppliedClientId = decoded.slice(0, separator);
      suppliedClientSecret = decoded.slice(separator + 1);
    }
    if (suppliedClientId !== CLIENT_ID || suppliedClientSecret !== CLIENT_SECRET) {
      sendProviderError(response, 401, 'invalid_client');
      return;
    }

    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code') ?? '';
      const record = authorizationCodes.get(code);
      const verifier = form.get('code_verifier') ?? '';
      const redirectUri = form.get('redirect_uri') ?? '';
      const computedChallenge = createHash('sha256').update(verifier).digest('base64url');
      if (!record || record.used || record.redirectUri !== redirectUri ||
          record.clientId !== suppliedClientId || record.challenge !== computedChallenge) {
        sendProviderError(response, 400, 'invalid_grant');
        return;
      }
      record.used = true;
      counters.codeExchanges += 1;
      writeJson(response, 200, {
        access_token: signedAccessToken(),
        token_type: 'Bearer',
        expires_in: 30,
        refresh_token: 'refresh-token-e2e-1',
        id_token: signedIdentityToken(record.nonce),
        scope: 'openid email profile offline_access',
      });
      return;
    }

    if (form.get('grant_type') === 'refresh_token') {
      if (!['refresh-token-e2e-1', 'refresh-token-e2e-2'].includes(form.get('refresh_token') ?? '')) {
        sendProviderError(response, 400, 'invalid_grant');
        return;
      }
      counters.refreshRequests += 1;
      writeJson(response, 200, {
        access_token: signedAccessToken(),
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: 'refresh-token-e2e-2',
        id_token: signedIdentityToken(),
        scope: 'openid email profile offline_access',
      });
      return;
    }

    sendProviderError(response, 400, 'unsupported_grant_type');
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/logout') {
    counters.logoutRequests += 1;
    response.writeHead(302, {
      location: requestUrl.searchParams.get('post_logout_redirect_uri') ?? callbackOrigin + '/',
      'cache-control': 'no-store',
    });
    response.end();
    return;
  }

  sendProviderError(response, 404, 'not_found');
}

function cryptoRandomId(): string {
  return randomBytes(18).toString('base64url');
}

async function openIdProvider(): Promise<void> {
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  privateSigningKey = pair.privateKey;
  const exported = pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  publicJwk = { ...exported, kid: 'realcube-e2e-key', alg: 'RS256', use: 'sig' };

  provider = createServer((request, response) => {
    void handleProviderRequest(request, response).catch(() => {
      if (!response.headersSent) sendProviderError(response, 500, 'test_provider_error');
      else response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    provider.once('error', reject);
    provider.listen(0, '127.0.0.1', resolve);
  });
  const address = provider.address() as AddressInfo;
  issuer = 'http://127.0.0.1:' + address.port;
}

const originalEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  baseUrl: process.env.PLATFORM_WEB_BASE_URL,
  secureCookie: process.env.SESSION_COOKIE_SECURE,
  redisUrl: process.env.REDIS_URL,
  rateLimitHeader: process.env.RATE_LIMIT_CLIENT_IP_HEADER,
  issuer: process.env.OIDC_ISSUER_URL,
  clientId: process.env.OIDC_CLIENT_ID,
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  redirectUri: process.env.OIDC_REDIRECT_URI,
  logoutRedirectUri: process.env.OIDC_POST_LOGOUT_REDIRECT_URI,
  audience: process.env.OIDC_AUDIENCE,
};

function restoreEnvironmentValue(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function trustedRequest(url: string, init: ConstructorParameters<typeof NextRequest>[1] = {}): NextRequest {
  const headers = new Headers(init.headers);
  headers.set('x-real-ip', '127.0.0.1');
  return new NextRequest(url, { ...init, headers });
}

describe('OIDC browser authentication flow against a local test identity provider', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PLATFORM_WEB_BASE_URL = callbackOrigin;
    process.env.SESSION_COOKIE_SECURE = 'false';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    process.env.RATE_LIMIT_CLIENT_IP_HEADER = 'x-real-ip';
    process.env.OIDC_CLIENT_ID = CLIENT_ID;
    process.env.OIDC_CLIENT_SECRET = CLIENT_SECRET;
    process.env.OIDC_REDIRECT_URI = callbackOrigin + '/api/auth/callback';
    process.env.OIDC_POST_LOGOUT_REDIRECT_URI = callbackOrigin + '/';
    process.env.OIDC_AUDIENCE = API_AUDIENCE;
    await openIdProvider();
    process.env.OIDC_ISSUER_URL = issuer;
  });

  beforeEach(() => {
    fakeRedis.entries.clear();
    fakeRedis.counters.clear();
    authorizationCodes.clear();
    counters.authorizationRequests = 0;
    counters.codeExchanges = 0;
    counters.refreshRequests = 0;
    counters.logoutRequests = 0;
  });

  afterEach(() => {
    fakeRedis.entries.clear();
    fakeRedis.counters.clear();
  });

  afterAll(async () => {
    if (provider?.listening) {
      await new Promise<void>(resolve => provider.close(() => resolve()));
    }
    restoreEnvironmentValue('NODE_ENV', originalEnvironment.nodeEnv);
    restoreEnvironmentValue('PLATFORM_WEB_BASE_URL', originalEnvironment.baseUrl);
    restoreEnvironmentValue('SESSION_COOKIE_SECURE', originalEnvironment.secureCookie);
    restoreEnvironmentValue('REDIS_URL', originalEnvironment.redisUrl);
    restoreEnvironmentValue('RATE_LIMIT_CLIENT_IP_HEADER', originalEnvironment.rateLimitHeader);
    restoreEnvironmentValue('OIDC_ISSUER_URL', originalEnvironment.issuer);
    restoreEnvironmentValue('OIDC_CLIENT_ID', originalEnvironment.clientId);
    restoreEnvironmentValue('OIDC_CLIENT_SECRET', originalEnvironment.clientSecret);
    restoreEnvironmentValue('OIDC_REDIRECT_URI', originalEnvironment.redirectUri);
    restoreEnvironmentValue('OIDC_POST_LOGOUT_REDIRECT_URI', originalEnvironment.logoutRedirectUri);
    restoreEnvironmentValue('OIDC_AUDIENCE', originalEnvironment.audience);
  });

  it('completes authorization-code + PKCE, refreshes the session and performs OIDC logout', async () => {
    const loginResponse = await login(trustedRequest(callbackOrigin + '/api/auth/login'));
    expect(loginResponse.status).toBe(302);
    expect(loginResponse.headers.get('cache-control')).toBe('no-store');

    const transactionCookie = loginResponse.cookies.get(transactionCookieName);
    const authorizationUrl = loginResponse.headers.get('location');
    expect(transactionCookie?.value).toBeTruthy();
    expect(transactionUrlHasSecurityParameters(authorizationUrl)).toBe(true);
    expect(transactionCookie?.httpOnly).toBe(true);
    expect(transactionCookie?.sameSite).toBe('lax');

    const providerResponse = await fetch(authorizationUrl as string, { redirect: 'manual' });
    expect(providerResponse.status).toBe(302);
    const callbackUrl = providerResponse.headers.get('location');
    expect(callbackUrl).toBeTruthy();

    const callbackResponse = await callback(trustedRequest(callbackUrl as string, {
      headers: { cookie: transactionCookieName + '=' + transactionCookie?.value },
    }));
    expect(callbackResponse.status).toBe(303);
    expect(new URL(callbackResponse.headers.get('location') as string).origin).toBe(callbackOrigin);

    const sessionCookie = callbackResponse.cookies.get(sessionCookieName);
    expect(sessionCookie?.value).toBeTruthy();
    expect(sessionCookie?.value).not.toBe(transactionCookie?.value);
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('lax');
    expect(counters.codeExchanges).toBe(1);

    const statusResponse = await sessionStatus(trustedRequest(callbackOrigin + '/api/auth/session', {
      headers: { cookie: sessionCookieName + '=' + sessionCookie?.value },
    }));
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json() as {
      authenticated: boolean;
      user?: { sub: string; email?: string; emailVerified: boolean };
    };
    expect(status.authenticated).toBe(true);
    expect(status.user).toMatchObject({
      sub: 'oidc-e2e-user-001',
      email: 'oidc-e2e-user@example.test',
      emailVerified: true,
    });
    expect(counters.refreshRequests).toBe(1);

    const logoutResponse = await logout(trustedRequest(callbackOrigin + '/api/auth/logout', {
      method: 'POST',
      headers: {
        cookie: sessionCookieName + '=' + sessionCookie?.value,
        origin: callbackOrigin,
        'sec-fetch-site': 'same-origin',
      },
    }));
    expect(logoutResponse.status).toBe(303);
    expect(new URL(logoutResponse.headers.get('location') as string).pathname).toBe('/logout');
    expect(logoutResponse.cookies.get(sessionCookieName)?.value).toBe('');
    expect(counters.logoutRequests).toBe(0);
    const providerLogoutResponse = await fetch(logoutResponse.headers.get('location') as string, { redirect: 'manual' });
    expect(providerLogoutResponse.status).toBe(302);
    expect(counters.logoutRequests).toBe(1);

    const afterLogoutResponse = await sessionStatus(trustedRequest(callbackOrigin + '/api/auth/session'));
    expect(afterLogoutResponse.status).toBe(200);
    await expect(afterLogoutResponse.json()).resolves.toMatchObject({ authenticated: false });
  });

  it('rejects callback state mismatch, refuses a replay and blocks cross-origin logout', async () => {
    const loginResponse = await login(trustedRequest(callbackOrigin + '/api/auth/login'));
    const transactionCookie = loginResponse.cookies.get(transactionCookieName);
    const authorizationUrl = loginResponse.headers.get('location') as string;
    const providerResponse = await fetch(authorizationUrl, { redirect: 'manual' });
    const callbackUrl = new URL(providerResponse.headers.get('location') as string);
    const originalState = callbackUrl.searchParams.get('state') as string;

    callbackUrl.searchParams.set('state', 'attacker-controlled-state');
    const mismatchResponse = await callback(trustedRequest(callbackUrl.toString(), {
      headers: { cookie: transactionCookieName + '=' + transactionCookie?.value },
    }));
    expect(mismatchResponse.status).toBe(303);
    expect(new URL(mismatchResponse.headers.get('location') as string).searchParams.get('auth_error')).toBe('callback');

    callbackUrl.searchParams.set('state', originalState);
    const successfulResponse = await callback(trustedRequest(callbackUrl.toString(), {
      headers: { cookie: transactionCookieName + '=' + transactionCookie?.value },
    }));
    expect(successfulResponse.status).toBe(303);
    expect(counters.codeExchanges).toBe(1);

    const replayResponse = await callback(trustedRequest(callbackUrl.toString(), {
      headers: { cookie: transactionCookieName + '=' + transactionCookie?.value },
    }));
    expect(replayResponse.status).toBe(303);
    expect(counters.codeExchanges).toBe(1);

    const sessionCookie = successfulResponse.cookies.get(sessionCookieName);
    const crossOriginLogout = await logout(trustedRequest(callbackOrigin + '/api/auth/logout', {
      method: 'POST',
      headers: {
        cookie: sessionCookieName + '=' + sessionCookie?.value,
        origin: 'https://attacker.example',
        'sec-fetch-site': 'cross-site',
      },
    }));
    expect(crossOriginLogout.status).toBe(403);
    expect(counters.logoutRequests).toBe(0);
  });
});

function transactionUrlHasSecurityParameters(value: string | null): boolean {
  if (!value) return false;
  const url = new URL(value);
  return url.searchParams.get('response_type') === 'code' &&
    url.searchParams.get('code_challenge_method') === 'S256' &&
    Boolean(url.searchParams.get('code_challenge')) &&
    Boolean(url.searchParams.get('state')) &&
    Boolean(url.searchParams.get('nonce'));
}
