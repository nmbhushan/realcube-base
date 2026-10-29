# Production Readiness Checklist

## Identity and access
- [ ] Configure OIDC issuer, audience, JWKS URL, callback and logout URLs.
- [ ] Keep the local OIDC protocol-flow integration suite in CI; separately verify authorization-code + PKCE, state/nonce checks, token refresh, logout and error handling with a non-production registration on the selected OIDC provider.
- [ ] Configure HTTPS, Secure/HttpOnly/SameSite cookies, Redis TLS/HA and managed secret injection for all web replicas.
- [ ] Verify nonce-based CSP against all UI routes and third-party resources; configure CSP and login-abuse alerts.
- [ ] Set RATE_LIMIT_CLIENT_IP_HEADER to a header overwritten by trusted ingress and validate limits through that ingress.
- [ ] Configure Redis/session-store alerts and load-test the selected thresholds.
- [ ] Verify the one-time bootstrap runbook against the chosen OIDC provider; rotate/remove bootstrap secrets immediately after use.
- [ ] Test database-managed administrator grants, last-admin protection, and disabled/replayed bootstrap attempts.
- [ ] Implement entitlement, roles/permissions and tenant guards.
- [ ] Define and test access-revocation SLA.
- [ ] Audit user, tenant, invitation, entitlement, Platform admin and role changes.
- [ ] Configure and test approved invitation email delivery, abuse/rate limits, expiry handling and link-redaction policies.

## Data
- [ ] Replace schema initialization with versioned migration tooling for all environments.
- [ ] Create least-privilege database users for each project.
- [ ] Configure encryption, backups, retention, alarms and restore drills.
- [ ] Define RPO/RTO per environment.
- [ ] Test tenant isolation, including workers and file access.

## Delivery and operations
- [ ] Configure Terraform remote state and locking.
- [ ] Review network topology, ingress/egress and IAM.
- [ ] Add container, dependency and secret scanning.
- [ ] Centralize logs, metrics, traces and alerts.
- [ ] Keep the PostgreSQL-backed tenant-isolation suite and real-JWKS JWT verification suite required in CI.
- [ ] Configure structured-log shipping, retention/access controls and alerts for OIDC failures, Redis session-store errors, PostgreSQL readiness and 5xx rates.
- [ ] Verify load-balancer access logs redact OIDC callback query strings and add a reviewed nonce-based CSP.
- [ ] Monitor outbox backlog, oldest unpublished event, failures and retry counts.
- [ ] Test load, failure, rollback and disaster recovery.
- [ ] Complete threat modeling and penetration testing.


## Production startup preflight

The frontend image runs `scripts/production-preflight.mjs` before starting Next.js whenever `PLATFORM_ENV=production`. It checks that the public origin and OIDC callback/logout URIs use the same HTTPS origin, secure cookies are enabled, OIDC issuer/JWKS/client values are configured, Redis uses `rediss://`, the API target is not loopback, and the trusted rate-limit client-IP header is named. The checker prints configuration-key names and issue descriptions only; it never prints secret values.

The Helm frontend deployment sets `PLATFORM_ENV=production` and defaults the client-IP header to `x-forwarded-for` for an AWS ALB ingress. Confirm the actual ingress overwrites/appends this header as expected, and ensure the frontend Service is private behind the trusted ingress. Supply the actual origin, issuer, client credentials, JWKS URL, API audience, exact callback/logout URLs, and TLS Redis URL via the configured Kubernetes secret. The local Compose file sets `PLATFORM_ENV=local`, so its disposable non-TLS Redis service can still be used for local development.

CI runs the preflight validator's Node test suite. This static/startup validation is not a provider connectivity test and does not replace the selected IdP smoke test.
