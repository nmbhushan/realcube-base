import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureSameOriginMutation,
  getOidcRedirectUri,
  getPlatformWebBaseUrl,
  isSecureCookieMode,
  parseCookie,
  safeStringEqual,
  sessionCookieName,
  sessionCookieOptions,
  transactionCookieOptions,
} from './server-auth';

const originalEnv = {
  nodeEnv: process.env.NODE_ENV,
  secure: process.env.SESSION_COOKIE_SECURE,
  baseUrl: process.env.PLATFORM_WEB_BASE_URL,
  redirectUri: process.env.OIDC_REDIRECT_URI,
};

beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.SESSION_COOKIE_SECURE = 'false';
  process.env.PLATFORM_WEB_BASE_URL = 'http://localhost:3000';
});

afterEach(() => {
  if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.secure === undefined) delete process.env.SESSION_COOKIE_SECURE;
  else process.env.SESSION_COOKIE_SECURE = originalEnv.secure;
  if (originalEnv.baseUrl === undefined) delete process.env.PLATFORM_WEB_BASE_URL;
  else process.env.PLATFORM_WEB_BASE_URL = originalEnv.baseUrl;
  if (originalEnv.redirectUri === undefined) delete process.env.OIDC_REDIRECT_URI;
  else process.env.OIDC_REDIRECT_URI = originalEnv.redirectUri;
});

describe('Platform web session security helpers', () => {
  it('compares OIDC state without accepting different or empty values', () => {
    expect(safeStringEqual('random-state-value', 'random-state-value')).toBe(true);
    expect(safeStringEqual('random-state-value', 'other-state-value')).toBe(false);
    expect(safeStringEqual('', '')).toBe(false);
    expect(safeStringEqual('short', 'longer')).toBe(false);
  });

  it('parses the requested opaque cookie without confusing similarly named cookies', () => {
    const request = new Request('http://localhost:3000/', {
      headers: { cookie: 'other_session=wrong; rc_session=a%2Fb%3D; flag=yes' },
    });
    expect(parseCookie(request, 'rc_session')).toBe('a/b=');
    expect(parseCookie(request, 'session')).toBeUndefined();
  });

  it('requires a strict same-origin match for mutation requests', () => {
    expect(ensureSameOriginMutation(new Request('http://localhost:3000/api/platform/admin/tenants', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin' },
    }))).toBe(true);

    expect(ensureSameOriginMutation(new Request('http://localhost:3000/api/platform/admin/tenants', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
    }))).toBe(false);

    expect(ensureSameOriginMutation(new Request('http://localhost:3000/api/platform/admin/tenants', {
      method: 'POST',
    }))).toBe(false);
  });

  it('restricts the registered callback to the same-origin OIDC route', () => {
    process.env.PLATFORM_WEB_BASE_URL = 'https://platform.example.com';
    delete process.env.OIDC_REDIRECT_URI;
    expect(getOidcRedirectUri()).toBe('https://platform.example.com/api/auth/callback');
    process.env.OIDC_REDIRECT_URI = 'https://attacker.example/api/auth/callback';
    expect(() => getOidcRedirectUri()).toThrow(/same-origin/);
    process.env.OIDC_REDIRECT_URI = 'https://platform.example.com/other';
    expect(() => getOidcRedirectUri()).toThrow(/same-origin/);
  });

  it('rejects an HTTPS-enabled deployment with an insecure public origin', () => {
    process.env.SESSION_COOKIE_SECURE = 'true';
    process.env.PLATFORM_WEB_BASE_URL = 'http://platform.example.com';
    expect(() => getPlatformWebBaseUrl()).toThrow(/HTTPS is required/);
  });

  it('uses host-only secure cookies in HTTPS mode and keeps session IDs opaque', () => {
    process.env.SESSION_COOKIE_SECURE = 'true';
    process.env.PLATFORM_WEB_BASE_URL = 'https://platform.example.com';
    expect(isSecureCookieMode()).toBe(true);
    expect(sessionCookieName()).toBe('__Host-rc_session');
    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(transactionCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('rejects a base URL containing a path or query string', () => {
    process.env.PLATFORM_WEB_BASE_URL = 'https://platform.example.com/admin?x=1';
    expect(() => getPlatformWebBaseUrl()).toThrow(/must be an origin/);
  });
});
