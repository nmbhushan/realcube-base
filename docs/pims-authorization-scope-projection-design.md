# PIMS Authorization Scope Projection — Design and Release Contract

## Status

Design gate for the next authorization increment. This document does not change runtime authorization behavior. Implement only after Platform's authoritative membership and role/permission mutation paths are confirmed and emit versioned events.

## Why this is a separate increment

The current PIMS projection is authoritative only for the PIMS project entitlement. It does not make token-carried permissions or tenant membership state live. Extending the existing event consumer by guessing event shapes would create a second, potentially inconsistent authorization source. Platform remains the system of record; PIMS receives a minimal, tenant-scoped projection.

## Required event contracts

Every event must use the existing envelope conventions and include a stable UUID `eventId`, `eventType`, `occurredAt`, and a payload with tenant identity, OIDC issuer and subject. The exact event names below are proposed names, not claims that Platform currently emits them.

### Tenant membership

- `platform.tenant_membership.activated`
- `platform.tenant_membership.suspended`
- `platform.tenant_membership.removed`

Payload minimum: `tenantId`, `userId`, `oidcIssuer`, `oidcSubject`, `status`, monotonic `membershipVersion`.

A membership state change must be committed to the Platform outbox in the same database transaction as the authoritative membership mutation. A missing membership row is not equivalent to active membership.

### Role and permission assignments

- `platform.project_role.granted`
- `platform.project_role.revoked`
- `platform.permission.changed` (only if Platform's authorization model supports direct permission assignments)

Payload minimum: `tenantId`, `userId`, `projectCode`, `roleCode` or `permissionCode`, `status`, monotonic version scoped to the relevant assignment, `oidcIssuer`, and `oidcSubject`.

Role/permission events must describe the resulting assignment state, not only a delta that requires replaying an unknown history. A role deletion or role-definition change must fan out effective permission changes, or the event contract must carry a versioned role-definition snapshot.

## Projection model

Use separate projection tables and independent version columns rather than overloading `pims_entitlement_projection`:

- `pims_membership_projection`: issuer, subject, tenant, status, membership version, source event and projection timestamps.
- `pims_role_projection`: issuer, subject, tenant, project, role code, status, assignment version, source event and projection timestamps.
- `pims_permission_projection`: issuer, subject, tenant, project, permission code, status, permission version, source event and projection timestamps, if direct permissions exist in Platform.

Each table must have forced RLS keyed by `app.tenant_id`. Runtime DB access must set tenant context inside the same transaction as every read/write. Use least-privilege grants; do not grant the PIMS runtime role ownership or RLS bypass.

## Authorization evaluation

For every protected request, after JWT signature, issuer, audience, expiry and subject validation:

1. Resolve tenant from trusted server-side request context; never trust a caller-supplied tenant ID as authorization.
2. Require a fresh, healthy projection for the exact issuer + subject + tenant.
3. Require active PIMS project entitlement.
4. Require active tenant membership.
5. Resolve effective roles/permissions from current projection and enforce the required permission.
6. Deny by default on missing rows, stale projection, unknown event version, database failure, or inconsistent identity mapping.

Do not treat token `permissions` or `roles` claims as current authorization. They may be retained for display/debugging only, never as the source of truth for protected operations.

## Ordering, idempotency and recovery

- Deduplicate by stable `eventId` in the same transaction as the projection write.
- Enforce strictly increasing versions per assignment key; stale events must not overwrite newer state.
- Use an explicit event schema version and reject malformed PIMS-relevant events without acknowledging them.
- Irrelevant valid events on a shared queue must be acknowledged safely.
- Poison events must trip readiness unhealthy and alert operators. Recovery requires fixing/redriving the event, reconciling the projection against Platform, and a controlled readiness reset.
- Snapshot/backfill events must use the same projection path and version semantics as live events.
- The consumer must not mark itself initially healthy before snapshot reconciliation.

## Required tests before implementation is considered complete

- Membership active → suspended → removed; old activation arrives after suspension.
- Role grant → revoke; old grant arrives after revoke.
- Role definition changes and role deletion invalidate effective permissions.
- Permission removal takes effect while the JWT remains unexpired.
- Tenant A cannot read or mutate Tenant B membership, roles, permissions or PIMS resources.
- Missing membership denies even when project entitlement is granted.
- Duplicate, malformed, unknown-version and out-of-order events.
- Consumer restart, SQS retry, visibility timeout and DLQ redrive.
- Database pool reuse does not leak tenant RLS context.
- Projection stale/unhealthy fails closed.
- Live non-production OIDC + Platform outbox + SQS test measures revoke-to-deny latency.

## Release gates

- [ ] Confirm actual Platform membership/role schema and all mutation entry points.
- [ ] Add outbox writes transactionally to every authoritative mutation path.
- [ ] Approve event names, payload schemas, event schema version and version scope.
- [ ] Add snapshot/backfill migrations and reconciliation tooling.
- [ ] Add PIMS projection migrations, RLS policies and least-privilege grants.
- [ ] Add consumer handlers and unit/integration tests.
- [ ] Update PIMS guard to use only projected authorization state.
- [ ] Run non-production OIDC/SQS end-to-end tests and DLQ drills.
- [ ] Approve and publish measured revocation SLA before production enablement.

## Explicit non-goals

This design does not authorize client-side-only checks, trust JWT role/permission claims as live state, query Platform tables directly from PIMS, or enable the SQS consumer in production. It does not prescribe Platform schema changes until the existing schema and mutation workflows are inspected.
