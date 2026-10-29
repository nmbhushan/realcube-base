# PIMS Pilot API — Initial Foundation

## Scope

The first PIMS pilot increment adds an independently containerized NestJS API, a project-owned PostgreSQL schema, an OIDC JWT guard, work-item read/create endpoints, and tenant isolation at both query and PostgreSQL row-level-security layers.

This is **an API foundation, not a production-ready PIMS deployment**. The dedicated Next.js PIMS frontend, control-plane entitlement projection/event consumer, full PostgreSQL integration tests, deployment chart/release pipeline, and production identity-provider smoke tests remain open.

## API surface

- `GET /api/v1/health/live` — process liveness.
- `GET /api/v1/health/ready` — PostgreSQL readiness.
- `GET /api/v1/work-items` — requires `pims:read`.
- `POST /api/v1/work-items` — requires `pims:write`.

The create DTO deliberately does not accept `tenantId`. The tenant is derived exclusively from the validated access token, and every data operation opens a transaction, sets a transaction-local tenant context and includes a tenant predicate. The schema enforces the same tenant boundary with PostgreSQL RLS.

## Access-token contract

The PIMS API validates the access token signature through the configured OIDC JWKS endpoint and validates issuer, audience, expiry and token age. It only permits the algorithm allowlist declared in the guard. The token must contain:

- Standard `iss` and non-empty `sub` claims.
- Audience matching `PIMS_OIDC_AUDIENCE` (default `pims-api`), plus valid expiry and issue time.
- `tenant_id`: the UUID of the tenant context that the issuer has verified for this user.
- `project_access`: an array containing `PIMS`.
- `permissions` (or the claim named by `PIMS_PERMISSIONS_CLAIM`): an array containing the exact permission needed for the route, such as `pims:read` or `pims:write`.

The default maximum token age is 300 seconds. The guard refuses a configured age above five minutes so the pilot has a bounded stale-token window. This only provides a revocation bound if the trusted issuer refreshes entitlement claims from the current Platform state and issues new tokens accordingly.

**Security gate:** the token claims above are an interface contract, not a substitute for integrating the source-of-truth Platform entitlements. Do not create static identity-provider permissions that can outlive a Platform grant. Before a pilot is approved, wire the issuer/entitlement projection to Platform grants, verify project and tenant selection, and test the revocation SLA against the real identity provider. Until then, configure no production audience/registration for this scaffold.

## Local development

1. Copy `.env.example` to `.env` and set local-only values for `POSTGRES_PASSWORD`, `PIMS_POSTGRES_ADMIN_PASSWORD` and `PIMS_APP_DB_PASSWORD`. Do not use production credentials.
2. Configure the selected development OIDC issuer, JWKS URL and PIMS audience before exercising protected routes. Protected API routes fail closed if OIDC is missing or invalid.
3. Start the stack with:

   ```bash
   docker compose --env-file .env -f docker/compose.yaml up --build
   ```

4. The Platform database and PIMS database run in different local PostgreSQL containers. The PIMS container creates a non-superuser `pims_app` role for the API. Existing database volumes do not rerun initialization scripts; back up and recreate only disposable development volumes if the initial schema changes.

The PIMS API is exposed on `http://localhost:3002`, with health endpoints under `/api/v1/health`. Its database uses host port 5433 by default.

## Database and deployment requirements

- Apply `database/pims/001_initial_schema.sql` through a reviewed, versioned migration job in shared environments; container entrypoint scripts are local-development convenience only.
- Provision `pims_app` as a dedicated database role without superuser, table-owner bypass or `BYPASSRLS` privileges. Keep the migration owner separate from the runtime role.
- Use private database networking, TLS with certificate verification, encrypted storage, managed credentials, backups, restore drills and least-privilege security groups.
- Apply an independently reviewed container image and deployment pipeline. Do not reuse the Platform database or query Platform tables from PIMS.
- Verify cross-tenant read and write denial with PostgreSQL integration tests using the runtime role.

## Remaining acceptance criteria

1. Choose the trusted identity-provider integration contract for mapping Platform memberships/entitlements into short-lived access-token claims or a project-local, event-fed entitlement projection.
2. Test identity binding, tenant isolation, project permission checks and revocation end-to-end against PostgreSQL and the selected OIDC provider.
3. Add the PIMS Next.js frontend with server-side token/session handling; do not expose refresh/access tokens to browser storage.
4. Add production Helm values, immutable-image rollout/rollback rehearsal, alerts, migration runbook and security review.
