# RealCube Base — Enterprise Workspace Foundation

This repository is the foundation for Enterprise Platform and the RealCube Enterprise Workspace.

## Architecture
- Central control plane: Enterprise Platform (user onboarding, tenant membership, project entitlements, roles/permissions and audit).
- OIDC identity provider performs authentication and token issuance; Platform owns application-level access policy.
- Nine independently deployable projects: PIMS, Sales, Broker, Snagging, LeMS, CAFM, OA, Finance and Support.
- One database owned by each project; no direct cross-project database access.
- Next.js frontend and NestJS API per project, independently containerized and deployed.
- Begin with modular NestJS backends; extract services when justified.
- Terraform-managed AWS foundation; EKS is the reference option, with ECS/Fargate to be evaluated based on team operations.

## Repository contents
The `docs/` directory records architecture, security model, implementation roadmap and production acceptance criteria. `apps/` contains the initial Enterprise Platform UI and API scaffold. `infra/` contains Terraform and Helm skeletons. `docker/` contains local development orchestration.

## Status
Initial scaffold. Not production-ready: OIDC, persisted administration APIs, authorization guards, AWS Terraform resources, migrations and full CI hardening must be completed before production use.
