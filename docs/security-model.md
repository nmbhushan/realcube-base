# Security Model

Before production:
- Configure OIDC issuer, audience, callback and logout URLs.
- Validate token signature, issuer, audience, expiry, not-before and allowed algorithms using a maintained library.
- Default-deny protected API routes; health endpoints must remain non-sensitive.
- Derive tenant scope from validated identity and verified membership, not client input alone.
- Enforce project entitlement, role/permission and resource scope in each API.
- Add cross-tenant and cross-project authorization tests to CI.
- Use separate project database credentials, private networking, TLS and encryption at rest.
- Load secrets at runtime from a secret manager; never commit credentials or include them in images.
- Audit administrative changes to users, tenants, entitlements and roles.
- Use workload identities or OAuth client credentials for service-to-service calls.

## Revocation
Set a maximum permission-revocation delay. Use short-lived tokens, entitlement versioning, cache TTLs and durable access-change events. High-risk operations may require a current policy check. Do not claim immediate revocation unless guaranteed by implementation.

## Browser
Consider a secure BFF/session pattern. Use Secure, HttpOnly and appropriately scoped SameSite cookies and CSRF controls where required. Do not place long-lived refresh tokens in localStorage.
