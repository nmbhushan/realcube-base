import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  logWebSecurityEvent: vi.fn(),
  ping: vi.fn(),
}));

vi.mock('./server-auth', () => ({
  getRedisClient: mocks.getRedisClient,
  logWebSecurityEvent: mocks.logWebSecurityEvent,
}));

import { GET as readiness } from '../app/api/health/ready/route';
import { GET as liveness } from '../app/api/health/live/route';

describe('web health routes for Kubernetes probes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRedisClient.mockResolvedValue({ ping: mocks.ping });
  });

  it('keeps liveness independent of Redis availability', async () => {
    mocks.getRedisClient.mockRejectedValue(new Error('redis credentials must never be exposed'));
    const response = await liveness();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok' });
    expect(mocks.getRedisClient).not.toHaveBeenCalled();
  });

  it('reports readiness only when the session store responds', async () => {
    mocks.ping.mockResolvedValue('PONG');
    const response = await readiness();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'ready',
      dependencies: { sessionStore: 'ok' },
    });
  });

  it('returns 503 without driver details when the session store is unavailable', async () => {
    mocks.getRedisClient.mockRejectedValue(new Error('redis://user:password@internal-host'));
    const response = await readiness();
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).not.toContain('password');
    expect(body).not.toContain('internal-host');
    expect(mocks.logWebSecurityEvent).toHaveBeenCalledWith('health.readiness.failed', {
      reason: 'session_store_unavailable',
      status: 503,
    });
  });

  it('returns 503 when Redis responds with an unexpected value', async () => {
    mocks.ping.mockResolvedValue('NOPE');
    const response = await readiness();
    expect(response.status).toBe(503);
  });
});
