# RealCube Base — Enterprise Workspace Foundation

Enterprise Platform and shared infrastructure foundation for the RealCube business application suite.

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

- Responsive Next.js Platform administration console connected to protected APIs for tenants, members/invitations, project access, roles and permissions.
- NestJS API with public health endpoints and protected admin API routes.
- PostgreSQL persistence via TypeORM; schema synchronization is disabled.
- Admin APIs for tenant creation, verified-email invitations, scoped project entitlements, tenant/project-scoped roles, permission assignment, Platform administrator grants and access-change audit/outbox events.
- OIDC JWT validation using a configured issuer, audience and JWKS endpoint. Protected admin routes fail closed when OIDC is not configured.
- Transactional audit/outbox records for tenant creation, invitations, memberships, project entitlements, Platform administrator changes and project-role changes.
- Docker Compose for the API, frontend, PostgreSQL and Redis-backed server sessions.
- Structured API request telemetry, database readiness probing, nonce-based CSP and Redis-backed web rate limits.
- Terraform/Helm starter files and security/operations documentation.

## Local development

Prerequisites: Node.js 22+, npm, Docker with Compose.

    cp .env.example .env
    # Set a local-only POSTGRES_PASSWORD.
    # Configure OIDC_ISSUER_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET..
    docker compose --env-file .env -f docker/compose.yaml up --build

Frontend: http://localhost:3000
Public API health: http://localhost:3001/api/v1/health
Browser sign-in: http://localhost:3000/api/auth/login
Browser API calls go through the same-origin `/api/platform/*` BFF. Access and refresh tokens remain on the server in Redis.

For direct host development, install dependencies in each app directory and use a host-reachable PostgreSQL URL rather than the Compose hostname postgres.

## First Platform administrator

Administrative routes require a valid OIDC access token and an **active database grant** in `platform_admin_grants`; a `platform:admin` token claim alone does not grant administrative access.

For the one-time bootstrap:
1. Apply database migrations 001, 002 and 003.
2. Provision the intended first administrator in the trusted OIDC provider.
3. Inject a random 32+ character `PLATFORM_BOOTSTRAP_SECRET` and set `PLATFORM_BOOTSTRAP_ENABLED=true` only during the bootstrap window.
4. Generate the secret, for example with `openssl rand -base64 48`, store it only in the approved secret manager, and call `POST /api/v1/bootstrap/platform-admin` with that user's valid Bearer token and the `x-platform-bootstrap-token` header.
5. Immediately set bootstrap disabled and remove/rotate the secret. The database state row prevents a second successful bootstrap, even if the feature flag is accidentally re-enabled.

See [docs/bootstrap-runbook.md](docs/bootstrap-runbook.md). Do not log the bootstrap header.

User onboarding is invitation-based: the API returns a one-time token whose hash alone is stored. A recipient must authenticate with OIDC and accept using a token whose verified email matches the invitation. The Platform does not create accounts at the identity provider, and automated email delivery is not configured. See [docs/platform-admin-workflows.md](docs/platform-admin-workflows.md).

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

This remains a development scaffold, not production-ready software. The browser now uses OIDC authorization code + PKCE, one-time state/nonce checks, opaque Redis-backed sessions, HttpOnly cookies and a same-origin API proxy. Before production use, configure and verify the real OIDC provider and Redis TLS/availability, deploy approved invite delivery and abuse controls, run end-to-end/tenant-isolation tests against PostgreSQL and the selected identity provider, harden CI/CD, implement and review real AWS Terraform resources, and validate alerting, backup/restore and disaster recovery. The Terraform repository contains network/ECR and remote-state bootstrap configurations, but CI never provisions AWS resources. Follow [the Terraform state runbook](docs/terraform-state-runbook.md) and obtain approval before any manual infrastructure plan/apply.

See [docs/browser-authentication.md](docs/browser-authentication.md), [docs/observability.md](docs/observability.md), [docs/production-readiness.md](docs/production-readiness.md), [docs/terraform-state-runbook.md](docs/terraform-state-runbook.md) and [docs/implementation-roadmap.md](docs/implementation-roadmap.md).

## Existing local database

The Docker entrypoint initialization scripts run only on an empty PostgreSQL data volume. If you already have a local volume created before migration 002/003, apply the missing migration(s) explicitly after backing up local data:

```bash
docker compose --env-file .env -f docker/compose.yaml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$PLATFORM_DB_NAME" < database/platform/002_admin_bootstrap_outbox.sql
docker compose --env-file .env -f docker/compose.yaml exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$PLATFORM_DB_NAME" < database/platform/003_platform_admin_workflows.sql
```

For production, apply versioned migrations through the approved migration job rather than the entrypoint initialization mechanism.

## Run API tests

```bash
cd apps/platform-api
npm install
npm run build
npm test -- --testPathIgnorePatterns=integration
```

The PostgreSQL integration suite requires a dedicated local test database (never use a production URL). The suite creates and drops a random schema inside that database, applies all three platform migrations there, and exercises tenant-scoped list queries, role-assignment guards, transactional access revocation, audit events and outbox events.

```bash
PLATFORM_TEST_DATABASE_URL=postgresql://workspace:your-test-password@localhost:5432/platform_test npm run test:integration
```

The integration database name must contain `test`. CI starts an isolated PostgreSQL 16 service and runs both the PostgreSQL suite and a real-JWKS JWT verification suite. The OIDC test uses a local ephemeral signing-key endpoint; it does not replace an end-to-end test against the production identity provider.


The current unit tests cover OIDC fail-closed behavior, database-backed administrator permission checks, one-time bootstrap behavior, outbox publishing/retry, tenant membership scoping, invitation email binding and role assignment preconditions. They are not a replacement for end-to-end tests against a configured identity provider and PostgreSQL.

The web test suite includes a local test identity provider that runs the actual Next.js auth route handlers through authorization-code + PKCE, ID-token validation, Redis-backed session creation, refresh, replay/mismatched-state rejection, and RP-initiated logout. This proves protocol flow against the local provider implementation; still run the production-readiness checklist against the actual chosen identity provider.

The production frontend image runs a fail-fast environment preflight before starting Next.js when `PLATFORM_ENV=production`. The preflight validates HTTPS origins, exact callback/logout URLs, Secure cookies, TLS Redis, OIDC metadata, a non-loopback API target, and the trusted ingress header without printing secret values. CI unit-tests this validator; see [docs/production-readiness.md](docs/production-readiness.md) for deployment requirements.


### Kubernetes rollout safeguards

The Helm chart now separates startup, liveness and readiness checks for the API and frontend. API readiness depends on PostgreSQL; frontend readiness verifies Redis, while liveness remains independent of external stores. Replicated workloads use zero-unavailable rolling updates, and PodDisruptionBudgets protect one replica during voluntary disruptions. CI runs Helm lint and renders the chart with non-placeholder test image names.

These safeguards validate manifests and rollout intent; validate capacity, ingress/network paths, and rollback behavior in a non-production EKS cluster before production deployment.


## Immutable-image releases

The Helm chart supports image digests in addition to tags. For a controlled deployment, use [the Platform release runbook](docs/platform-release-runbook.md) and `scripts/deploy-platform.sh`. The script requires an explicit Kubernetes context and SHA-256-pinned API/frontend images, waits for both deployments, checks frontend liveness/readiness over HTTPS, and attempts recovery if post-deployment checks fail. Rehearse it in non-production EKS first; it does not deploy infrastructure or reverse database migrations.


## EKS infrastructure foundation

The Terraform module provides an opt-in private EKS control plane and managed node group, explicit cluster-admin access entries, encrypted Kubernetes Secrets, control-plane logging, and optional Pod Identity for both the outbox worker and the VPC CNI. CNI identity is staged: retain node-role permissions until the dedicated `kube-system/aws-node` association is validated, then remove them only through a second approved apply. EKS remains disabled by default and CI does not provision AWS resources. Follow [the EKS foundation runbook](docs/eks-foundation-runbook.md), [the VPC CNI identity runbook](docs/eks-vpc-cni-pod-identity-runbook.md), and remote-state instructions before infrastructure work.
