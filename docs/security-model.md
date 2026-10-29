# Security Model

## Authentication
Protected endpoints require a Bearer token signed by the configured OIDC provider. The API verifies signature via configured JWKS URL, issuer, audience, expiry, not-before, and an explicit algorithm allowlist. The application does not implement password storage or token issuance.

## Control-plane admin gate (current stage)
Admin endpoints require the platform:admin permission in the configured token permissions claim (default permissions) or scope claim. This is an initial gate from the trusted identity provider, not the final database-managed Platform administrator model. Do not accept permissions from request bodies or frontend state. Next increment: bootstrap flow plus database-managed Platform administrator grants and revocation tests.

## Authorization
Every business API must locally validate tokens and enforce project entitlement, tenant membership, role/permission and resource scope. The frontend module list is not a security boundary. Derive tenant scope from validated identity and verified membership, not client input alone. Add cross-tenant and cross-project tests to CI.

## Data
Use separate database credentials for each project, private networking, TLS and encryption at rest. Never query another project's tables. Keep secrets out of source control and container images; use a secret manager.

## Revocation
Set a maximum permission-revocation delay. Use short-lived tokens, entitlement versioning, cache TTLs and durable access-change events. High-risk operations may require a current policy check. Do not claim immediate revocation unless guaranteed by implementation.

## Browser and service-to-service
Consider a secure BFF/session pattern. Use Secure, HttpOnly and appropriately scoped SameSite cookies and CSRF controls where required. Do not place long-lived refresh tokens in localStorage. Use workload identities or OAuth client credentials for service-to-service calls.
