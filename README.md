# RealCube Base — Enterprise Workspace Foundation

Phase 1 foundation for Enterprise Platform and shared infrastructure patterns.

## Approved architecture
- Enterprise Platform is the central identity and access control plane for onboarding, tenants, project entitlements, roles/permissions and audit.
- A trusted OIDC identity provider performs authentication and token issuance; Platform is not a custom password store.
- Nine independent projects: PIMS, Sales, Broker, Snagging, LeMS, CAFM, OA, Finance and Support.
- One logically separate PostgreSQL database per project: platform_db, pims_db, sales_db, broker_db, snagging_db, lems_db, cafm_db, oa_db, finance_db and support_db.
- Each project owns its migrations and data. No direct cross-project database queries.
- Every project will have a Next.js frontend and NestJS API, independently containerized and released.
- Start with modular NestJS APIs; extract services only when justified.
- AWS infrastructure is Terraform-managed. EKS is the reference option; evaluate ECS/Fargate if lower operations overhead is preferred.

## Contents
- apps/platform-web: Next.js project registry/admin landing page
- apps/platform-api: NestJS starter API with health and static registry placeholder
- database/platform: Platform schema reference
- docker/compose.yaml: local PostgreSQL and application containers
- infra/terraform: Terraform environment skeleton
- infra/helm/platform: Helm chart starter
- docs: architecture, security, implementation roadmap and production-readiness criteria
- .github/workflows/ci.yml: basic build validation

## Local development
Prerequisites: Node.js 22+, npm, Docker with Compose.
    cp .env.example .env
    # Change POSTGRES_PASSWORD to a local development value.
    docker compose --env-file .env -f docker/compose.yaml up --build

Frontend: http://localhost:3000
API health: http://localhost:3001/api/v1/health

The starter endpoints do not implement authentication or authorization and must not be used to protect real data. The UI uses static placeholder data.

## Security rules
1. Never commit credentials, actual .env files, tokens or Terraform state.
2. Every business API must validate token signature, issuer, audience, expiry and allowed algorithms using a maintained OIDC/JWT library.
3. Resolve tenant scope from validated identity and verified membership; never trust a client-supplied tenant ID alone.
4. Every API enforces project entitlement, role/permission and resource scope locally.
5. Define token expiry, policy refresh and revocation behavior.
6. Use separate database credentials and least privilege. Keep databases private and do not query another project's tables.
7. Production requires reviewed Terraform, backups/restore drills, monitoring, vulnerability scanning and environment-specific IAM.

## Scope warning
This is an initial scaffold, not production-ready software. Terraform intentionally creates no AWS resources yet. OIDC login, persisted control-plane APIs, authorization guards, complete migrations, hardened CI/CD, alerts and disaster recovery need implementation before production use.

See docs/production-readiness.md and docs/implementation-roadmap.md.
