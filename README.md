# RealCube Base — Enterprise Workspace Foundation

Phase 1 foundation for Enterprise Platform and shared infrastructure patterns.

## Approved architecture

- Enterprise Platform is the central identity and access control plane for onboarding, tenants, project entitlements, roles/permissions and audit.
- A trusted OIDC identity provider performs authentication and token issuance; Platform is not a custom password store.
- Nine independent projects: PIMS, Sales, Broker, Snagging, LeMS, CAFM, OA, Finance and Support.
- One logically separate PostgreSQL database per project: platform_db, pims_db, sales_db, broker_db, snagging_db, lems_db, cafm_db, oa_db, finance_db and support_db.
- Each project owns its migrations and data. No direct cross-project database queries.
- Each project has a Next.js frontend and NestJS API, independently containerized and released.
- Start with modular NestJS APIs; extract services only when justified.
- AWS infrastructure is Terraform-managed. EKS is the reference option; evaluate ECS/Fargate if lower operational overhead is preferred.

## Implemented in this branch

- Next.js Platform project-registry preview.
- NestJS API with public health endpoints and protected admin API routes.
- PostgreSQL persistence via TypeORM; schema synchronization is disabled.
- Admin endpoints for project registry, tenant creation/listing, user-profile mapping/listing, entitlement listing, and granting/revoking user-project access.
- OIDC JWT validation using a configured issuer, audience and JWKS endpoint. Protected admin routes fail closed when OIDC is not configured.
- Audit records for tenant creation, user-profile creation and access changes.
- Docker Compose for local API, frontend and PostgreSQL.
- Terraform/Helm starter files and security/operations documentation.

## Local development

Prerequisites: Node.js 22+, npm, Docker with Compose.

    cp .env.example .env
    # Set a local-only POSTGRES_PASSWORD.
    # Configure OIDC settings to call protected admin APIs.
    docker compose --env-file .env -f docker/compose.yaml up --build

Frontend: http://localhost:3000
Public API health: http://localhost:3001/api/v1/health
Protected admin routes: http://localhost:3001/api/v1/admin/*

For direct host development, install dependencies in each app directory and use a host-reachable PostgreSQL URL rather than the Compose hostname postgres.

## First Platform administrator

Administrative routes require a valid OIDC access token and an **active database grant** in `platform_admin_grants`; a `platform:admin` token claim alone does not grant administrative access.

For the one-time bootstrap:
1. Apply database migrations 001 and 002.
2. Provision the intended first administrator in the trusted OIDC provider.
3. Inject a random 32+ character `PLATFORM_BOOTSTRAP_SECRET` and set `PLATFORM_BOOTSTRAP_ENABLED=true` only during the bootstrap window.
4. Generate the secret, for example with `openssl rand -base64 48`, store it only in the approved secret manager, and call `POST /api/v1/bootstrap/platform-admin` with that user's valid Bearer token and the `x-platform-bootstrap-token` header.
5. Immediately set bootstrap disabled and remove/rotate the secret. The database state row prevents a second successful bootstrap, even if the feature flag is accidentally re-enabled.

See [docs/bootstrap-runbook.md](docs/bootstrap-runbook.md). Do not log the bootstrap header.

The user-profile endpoint maps an already-provisioned OIDC subject into Platform; it does not create/invite the identity at the OIDC provider.

## Durable access-change events

Access changes, administrator grants/revocations and onboarding events are written to `access_change_outbox` in the same transaction as the state change and audit record. A separately deployed worker can publish pending events to SQS by setting `OUTBOX_PUBLISHER_ENABLED=true`, `ACCESS_EVENTS_QUEUE_URL`, `PLATFORM_DATABASE_URL` and `AWS_REGION`. Delivery is at-least-once; consumers must deduplicate using `eventId`. See [docs/access-events.md](docs/access-events.md).

## Security rules

1. Never commit credentials, actual .env files, tokens or Terraform state.
2. Validate token signature, issuer, audience, expiry and allowed algorithms with a maintained OIDC/JWT library.
3. Resolve tenant scope from validated identity and verified membership; never trust a client-supplied tenant ID alone.
4. Every business API must enforce project entitlement, role/permission and resource scope locally.
5. Define token expiry, policy refresh and revocation behavior.
6. Use separate database credentials and least privilege. Keep databases private and do not query another project's tables.
7. Production requires reviewed Terraform, migrations, backups/restore drills, monitoring, vulnerability scanning and environment-specific IAM.

## Important status

This is a development scaffold, not production-ready software. OIDC provider configuration, database-managed control-plane admin grants, invitation lifecycle, complete tests, durable access-change events/outbox, hardened CI/CD, real AWS Terraform resources, alerts and disaster recovery need to be completed and verified before production use. The Terraform skeleton intentionally creates no AWS resources.

See docs/production-readiness.md and docs/implementation-roadmap.md.

## Existing local database

The Docker entrypoint initialization scripts run only on an empty PostgreSQL data volume. If you already have a local volume created before migration 002, apply the migration explicitly after backing up local data:

```bash
docker compose --env-file .env -f docker/compose.yaml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$PLATFORM_DB_NAME" < database/platform/002_admin_bootstrap_outbox.sql
```

For production, apply versioned migrations through the approved migration job rather than the entrypoint initialization mechanism.

## Run API tests

```bash
cd apps/platform-api
npm install
npm run build
npm test
```

The current unit tests cover OIDC fail-closed behavior, database-backed administrator permission checks, one-time bootstrap behavior, outbox publishing/retry behavior, and tenant membership scoping. They are not a replacement for end-to-end tests against a configured identity provider and PostgreSQL.
