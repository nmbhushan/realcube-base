import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy } from './csp';

describe('nonce-based Content Security Policy', () => {
  const nonce = '0123456789abcdef0123456789abcdef';

  it('allows only same-origin resources and scripts carrying this request nonce', () => {
    const policy = buildContentSecurityPolicy(nonce);
    expect(policy).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain('https:');
  });

  it('adds HTTPS upgrades only in production mode', () => {
    expect(buildContentSecurityPolicy(nonce, false)).not.toContain('upgrade-insecure-requests');
    expect(buildContentSecurityPolicy(nonce, true)).toContain('upgrade-insecure-requests');
  });

  it('rejects malformed or overly short nonces', () => {
    expect(() => buildContentSecurityPolicy('short')).toThrow(/nonce/);
    expect(() => buildContentSecurityPolicy('nonce with spaces 123456789012')).toThrow(/nonce/);
  });
});
