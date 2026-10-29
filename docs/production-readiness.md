# Production Readiness Checklist

## Identity and access
- [ ] Configure an OIDC provider and secure login/session lifecycle.
- [ ] Implement API token validation using a maintained library.
- [ ] Implement entitlement, roles/permissions and tenant guards.
- [ ] Define and test access revocation SLA.
- [ ] Audit administrative access changes.

## Data
- [ ] Implement versioned migrations and schema-change policy.
- [ ] Create least-privilege database users for each project.
- [ ] Configure encryption, backups, retention, alarms and restore drills.
- [ ] Define RPO/RTO per environment.
- [ ] Test tenant isolation, including workers and file access.

## Delivery and operations
- [ ] Configure Terraform remote state and locking.
- [ ] Review network topology, ingress/egress and IAM.
- [ ] Add container, dependency and secret scanning.
- [ ] Centralize logs, metrics, traces and alerts.
- [ ] Test load, failure, rollback and disaster recovery.
- [ ] Complete threat modeling and security testing.
