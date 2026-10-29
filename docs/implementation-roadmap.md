# Implementation Roadmap

## Stage 1 — Foundation
1. Confirm OIDC provider, tenant model and AWS account strategy.
2. Protect the repository and configure CI.
3. Build reviewed Terraform modules and secure remote state. Network/ECR modules, remote-state bootstrap/migration configuration, and the EKS module are implemented; actual state migration and infrastructure provisioning require an approved operator.
4. Establish ECR, Docker build and deployment standards. Immutable image references and a guarded Helm rollout/rollback script are implemented; end-to-end release rehearsal remains outstanding.
5. Deploy and rehearse the opt-in private EKS baseline in non-production before production deployment.
6. Validate the dedicated VPC CNI Pod Identity in staging, then complete the separately approved node-role policy cutover using the [CNI identity runbook](eks-vpc-cni-pod-identity-runbook.md).
7. Provision the optional Load Balancer Controller identity and WAF ACL, install the pinned controller chart from a private operator path, and validate ALB ingress/TLS/WAF in staging before production.

## Stage 2 — Platform API
1. Implement persistence for tenants, users, projects, entitlements, roles, permissions and audit.
2. Integrate OIDC identity mapping.
3. Implement protected administrative APIs.
4. Add reliable access-change publishing with an outbox pattern.
5. Add tenant isolation, access and audit tests.

## Stage 3 — Platform UI
1. Implement secure sign-in/session flow.
2. Build tenant/user onboarding screens.
3. Add project entitlement and role/permission management.
4. Add audit log views.

## Stage 4 — Pilot business project
- Initial PIMS API foundation added: OIDC JWT verification, PIMS permission guards, tenant-scoped work-item endpoints, a dedicated schema and forced PostgreSQL RLS.
- Remaining before the pilot is accepted: bind token claims to current Platform entitlements, verify the real-provider revocation SLA, add the Next.js PIMS frontend and server-side session flow, run PostgreSQL tenant-isolation integration tests, and rehearse independent deployment/rollback.
- Prove token validation, project permissions, tenant isolation, database ownership, independent deployment and revocation behavior with PIMS before templating the other eight projects.

## Stage 5 — Production readiness
Complete load tests, restore drills, RPO/RTO validation, incident runbooks, security review and rollback tests.
