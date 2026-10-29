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

## Protected API permission requirement

Admin endpoints currently require the validated access token to contain platform:admin in the configured token permissions claim (default permissions array) or scope claim. Configure this at the trusted identity provider as the initial control-plane administrator gate. Do not trust a browser-supplied permission list. The next security increment should add database-managed Platform administrator grants, a controlled bootstrap flow, and tests for revocation.

The user-profile endpoint maps an already-provisioned OIDC subject into Platform; it does not create/invite the identity at the OIDC provider.

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
