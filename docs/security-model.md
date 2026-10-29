# Security Model

## Authentication
Protected endpoints require a Bearer token signed by the configured OIDC provider. The API verifies signature via configured JWKS URL, issuer, audience, expiry, not-before, and an explicit algorithm allowlist. The application does not implement password storage or token issuance.

## Control-plane admin gate
Admin endpoints require an active `platform:admin` grant in `platform_admin_grants`, joined to an active Platform user identified by the exact OIDC issuer and subject. Token permission claims and frontend state do not grant Platform administrator access.

The first grant can be created only through the one-time bootstrap route. It requires a valid OIDC bearer token, a random 32+ character bootstrap secret, an explicitly enabled bootstrap flag, and an incomplete singleton state row. Bootstrap and administrator grant/revoke operations use a PostgreSQL advisory lock to serialize changes; the last active administrator cannot be revoked. Disable bootstrap and remove its secret immediately after success.

The current bootstrap route is authenticated by the global OIDC guard before the database permission guard bypasses its administrator check. The bypass applies only to that route and does not make it public.

## Authorization
Every business API must locally validate tokens and enforce project entitlement, tenant membership, role/permission and resource scope. The frontend module list is not a security boundary. Derive tenant scope from validated identity and verified membership, not client input alone. Add cross-tenant and cross-project tests to CI.

## Data
Use separate database credentials for each project, private networking, TLS and encryption at rest. Never query another project's tables. Keep secrets out of source control and container images; use a secret manager.

## Revocation
Set a maximum permission-revocation delay. Use short-lived tokens, entitlement versioning, cache TTLs and durable access-change events. High-risk operations may require a current policy check. Do not claim immediate revocation unless guaranteed by implementation.

## Browser and service-to-service
Consider a secure BFF/session pattern. Use Secure, HttpOnly and appropriately scoped SameSite cookies and CSRF controls where required. Do not place long-lived refresh tokens in localStorage. Use workload identities or OAuth client credentials for service-to-service calls.

## Outbox
Access-changing transactions write durable outbox records atomically with the database state and audit record. The SQS publisher uses a lease/claim query and retries failures with backoff. Delivery is at-least-once; consumers must be idempotent and deduplicate by eventId. Queue permissions should be limited to the configured queue, and the worker should use its own workload identity rather than sharing the API service account.


## Invitation and project role lifecycle
New tenant membership is created through a one-time invitation; callers cannot choose the invitee's OIDC subject. The token's SHA-256 hash is stored, and accepting requires an OIDC-validated `iss`/`sub` plus a provider-verified email matching the invitation. The invitation is consumed in a database transaction. Invitation URLs use URL fragments so the raw token is not included in the HTTP request path; deliver links only through an approved channel.

Project roles are scoped to both tenant and project. Role assignment requires an active tenant membership, a role with the exact same scope, and a granted project entitlement. Revoking an entitlement deletes the user's project-role assignments within the same transaction and emits audit/outbox events. Consumers and project APIs must still enforce their own authorization locally.
