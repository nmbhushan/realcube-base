export function buildContentSecurityPolicy(nonce: string, production = false): string {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(nonce)) throw new Error('Invalid CSP nonce');
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ];
  if (production) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}
