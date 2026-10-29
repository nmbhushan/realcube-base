# Production Readiness Checklist

## Identity and access
- [ ] Configure OIDC issuer, audience, JWKS URL, callback and logout URLs.
- [ ] Implement secure login/session lifecycle and error handling.
- [ ] Implement database-managed Platform admin grants and a controlled bootstrap procedure.
- [ ] Implement entitlement, roles/permissions and tenant guards.
- [ ] Define and test access-revocation SLA.
- [ ] Audit user, tenant, entitlement and role changes.

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
- [ ] Add automated API, authentication, authorization and isolation tests.
- [ ] Test load, failure, rollback and disaster recovery.
- [ ] Complete threat modeling and penetration testing.
