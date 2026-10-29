import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockRedis = vi.hoisted(() => ({
  isOpen: true,
  eval: vi.fn(),
  on: vi.fn(),
  connect: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  getDel: vi.fn(),
  quit: vi.fn(),
  multi: vi.fn(),
  duplicate: vi.fn(),
}));

vi.mock('redis', () => ({
  createClient: vi.fn(() => mockRedis),
}));

import {
  checkRequestRateLimit,
  consumeRateLimit,
  getTrustedRateLimitSubject,
} from './server-auth';

const originalEnv = {
  nodeEnv: process.env.NODE_ENV,
  redisUrl: process.env.REDIS_URL,
  ipHeader: process.env.RATE_LIMIT_CLIENT_IP_HEADER,
};

beforeEach(() => {
  mockRedis.isOpen = true;
  mockRedis.eval.mockReset();
  mockRedis.on.mockClear();
  mockRedis.connect.mockClear();
  process.env.NODE_ENV = 'test';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.RATE_LIMIT_CLIENT_IP_HEADER = 'x-real-ip';
});

afterEach(() => {
  if (originalEnv.nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalEnv.nodeEnv;
  if (originalEnv.redisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalEnv.redisUrl;
  if (originalEnv.ipHeader === undefined) delete process.env.RATE_LIMIT_CLIENT_IP_HEADER;
  else process.env.RATE_LIMIT_CLIENT_IP_HEADER = originalEnv.ipHeader;
});

describe('Redis-backed request rate limiting', () => {
  it('returns an allowed decision and hashes the rate-limit subject in the Redis key', async () => {
    mockRedis.eval.mockResolvedValueOnce([2, 60]);
    const decision = await consumeRateLimit('oidc-login', '203.0.113.10', 10, 600);
    expect(decision).toEqual({
      allowed: true, limit: 10, remaining: 8, retryAfterSeconds: 0,
    });
    const [script, options] = mockRedis.eval.mock.calls[0];
    expect(script).toContain("redis.call('INCR'");
    expect(script).toContain("redis.call('EXPIRE'");
    expect(options.keys[0]).toMatch(/^realcube:platform:rate-limit:oidc-login:[a-f0-9]{64}$/);
    expect(options.keys[0]).not.toContain('203.0.113.10');
  });

  it('denies over-limit requests and includes a positive retry interval', async () => {
    mockRedis.eval.mockResolvedValueOnce([11, 47]);
    await expect(consumeRateLimit('oidc-login', 'client-a', 10, 600)).resolves.toMatchObject({
      allowed: false, limit: 10, remaining: 0, retryAfterSeconds: 47,
    });
  });

  it('fails closed when Redis returns invalid data or is unavailable', async () => {
    mockRedis.eval.mockResolvedValueOnce({ count: 2 });
    await expect(consumeRateLimit('oidc-login', 'client-a', 10, 600)).rejects.toThrow(/Unexpected Redis/);
    mockRedis.eval.mockRejectedValueOnce(new Error('redis down'));
    await expect(consumeRateLimit('oidc-login', 'client-a', 10, 600)).rejects.toThrow('redis down');
  });

  it('uses the configured trusted IP header and the final address in X-Forwarded-For', () => {
    const request = new Request('https://platform.example.com/', {
      headers: { 'x-real-ip': '192.0.2.20' },
    });
    expect(getTrustedRateLimitSubject(request)).toBe('192.0.2.20');
    process.env.RATE_LIMIT_CLIENT_IP_HEADER = 'x-forwarded-for';
    const forwarded = new Request('https://platform.example.com/', {
      headers: { 'x-forwarded-for': '198.51.100.7, 192.0.2.21' },
    });
    expect(getTrustedRateLimitSubject(forwarded)).toBe('192.0.2.21');
  });

  it('requires an explicit trusted client IP header configuration in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.RATE_LIMIT_CLIENT_IP_HEADER;
    expect(() => getTrustedRateLimitSubject(new Request('https://platform.example.com/'))).toThrow(/trusted ingress header/);
  });

  it('rejects invalid rate-limit settings', async () => {
    await expect(consumeRateLimit('../login', 'client-a', 10, 60)).rejects.toThrow(/bucket/);
    await expect(consumeRateLimit('oidc-login', 'client-a', 0, 60)).rejects.toThrow(/rate limit/);
  });
});
