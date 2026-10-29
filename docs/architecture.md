# Enterprise Workspace Architecture

Enterprise Platform plus nine independently deployed projects: PIMS, Sales, Broker, Snagging, LeMS, CAFM, OA, Finance and Support. Each project owns a Next.js frontend, NestJS backend, database, migrations, images and release pipeline.

Enterprise Platform manages user onboarding, tenant membership, identity links, project registry, entitlements, roles/permissions, access administration and audit. A trusted OIDC provider performs authentication and token issuance.

Each API validates tokens locally and applies project, tenant, role, permission and resource-level checks. Platform is not a synchronous dependency for every business request. Define token expiry, entitlement refresh and revocation delay.

Ten logical databases: platform_db, pims_db, sales_db, broker_db, snagging_db, lems_db, cafm_db, oa_db, finance_db and support_db. No direct cross-project database reads/writes.

Start with modular NestJS applications. Extract services when justified by scaling, ownership, workload or security boundaries. Use Terraform-managed AWS and evaluate EKS vs ECS/Fargate against team operational capability.
