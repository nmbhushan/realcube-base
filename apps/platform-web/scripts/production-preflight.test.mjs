import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionEnvironment } from './production-preflight.mjs';

function validProductionEnv() {
  return {
    PLATFORM_ENV: 'production',
    NODE_ENV: 'production',
    PLATFORM_WEB_BASE_URL: 'https://platform.example.com',
    PLATFORM_API_INTERNAL_URL: 'http://platform-api:3001',
    SESSION_COOKIE_SECURE: 'true',
    REDIS_URL: 'rediss://cache.internal.example.com:6380',
    RATE_LIMIT_CLIENT_IP_HEADER: 'x-forwarded-for',
    OIDC_ISSUER_URL: 'https://login.identity.example.com/tenant/v2.0',
    OIDC_CLIENT_ID: 'realcube-platform-web',
    OIDC_CLIENT_SECRET: 'test-client-secret',
    OIDC_REDIRECT_URI: 'https://platform.example.com/api/auth/callback',
    OIDC_POST_LOGOUT_REDIRECT_URI: 'https://platform.example.com/',
    OIDC_JWKS_URL: 'https://login.identity.example.com/tenant/discovery/v2.0/keys',
    OIDC_AUDIENCE: 'enterprise-platform-api',
  };
}

test('accepts a complete production configuration', () => {
  assert.deepEqual(validateProductionEnvironment(validProductionEnv()), []);
});

test('does not block the local Compose configuration', () => {
  assert.deepEqual(validateProductionEnvironment({
    PLATFORM_ENV: 'local',
    PLATFORM_WEB_BASE_URL: 'http://localhost:3000',
    REDIS_URL: 'redis://redis:6379',
  }), []);
});

test('reports missing required values without echoing values or secrets', () => {
  const env = validProductionEnv();
  delete env.OIDC_CLIENT_SECRET;
  delete env.REDIS_URL;
  delete env.PLATFORM_WEB_BASE_URL;
  const errors = validateProductionEnvironment(env);
  assert.ok(errors.some(issue => issue.startsWith('OIDC_CLIENT_SECRET:')));
  assert.ok(errors.some(issue => issue.startsWith('REDIS_URL:')));
  assert.ok(errors.some(issue => issue.startsWith('PLATFORM_WEB_BASE_URL:')));
  assert.equal(errors.some(issue => issue.includes('test-client-secret')), false);
});

test('rejects non-TLS Redis and insecure cookies', () => {
  const env = validProductionEnv();
  env.REDIS_URL = 'redis://cache.internal.example.com:6379';
  env.SESSION_COOKIE_SECURE = 'false';
  const errors = validateProductionEnvironment(env);
  assert.ok(errors.some(issue => issue.startsWith('REDIS_URL:') && issue.includes('rediss://')));
  assert.ok(errors.some(issue => issue.startsWith('SESSION_COOKIE_SECURE:')));
});

test('rejects callback and logout URLs on a different origin', () => {
  const env = validProductionEnv();
  env.OIDC_REDIRECT_URI = 'https://attacker.example/api/auth/callback';
  env.OIDC_POST_LOGOUT_REDIRECT_URI = 'https://attacker.example/';
  const errors = validateProductionEnvironment(env);
  assert.ok(errors.some(issue => issue.startsWith('OIDC_REDIRECT_URI:') && issue.includes('same origin')));
  assert.ok(errors.some(issue => issue.startsWith('OIDC_POST_LOGOUT_REDIRECT_URI:') && issue.includes('same origin')));
});

test('rejects placeholder issuer metadata and loopback API/Redis endpoints', () => {
  const env = validProductionEnv();
  env.OIDC_ISSUER_URL = 'https://YOUR_IDENTITY_PROVIDER/';
  env.OIDC_JWKS_URL = 'https://YOUR_IDENTITY_PROVIDER/.well-known/jwks.json';
  env.PLATFORM_API_INTERNAL_URL = 'http://127.0.0.1:3001';
  env.REDIS_URL = 'rediss://localhost:6380';
  const errors = validateProductionEnvironment(env);
  assert.ok(errors.some(issue => issue.startsWith('OIDC_ISSUER_URL:') && issue.includes('placeholder')));
  assert.ok(errors.some(issue => issue.startsWith('OIDC_JWKS_URL:') && issue.includes('placeholder')));
  assert.ok(errors.some(issue => issue.startsWith('PLATFORM_API_INTERNAL_URL:') && issue.includes('loopback')));
  assert.ok(errors.some(issue => issue.startsWith('REDIS_URL:') && issue.includes('loopback')));
});
