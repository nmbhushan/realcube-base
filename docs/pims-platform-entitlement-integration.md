# PIMS Platform Entitlement Integration Contract

## Status

Design contract for the next implementation increment. The current PIMS API validates OIDC signature, issuer, audience, token age, tenant claim, `project_access`, and permission claims. Those claims are a snapshot: **they do not prove that a Platform entitlement remains active after token issuance**. Do not treat the existing claim-only guard as meeting revocation requirements.

## Target authorization flow

1. The trusted OIDC provider authenticates the user and issues a short-lived access token for the PIMS API.
2. PIMS validates signature, issuer, audience, allowed algorithms, expiry, and maximum token age using the configured JWKS endpoint.
3. PIMS derives the subject from the verified `iss` + `sub` pair. Tenant context must be resolved from active Platform membership; a caller-supplied tenant header or request body is never authoritative.
4. PIMS obtains current PIMS entitlement and permission grants from a versioned authorization projection maintained from Platform access-change events. The projection is local to PIMS; PIMS must not query Platform tables directly.
5. A missing, revoked, suspended, stale-beyond-policy, or unknown entitlement fails closed. The policy must specify a maximum revocation delay and how projection lag is measured.
6. The PIMS database transaction sets `app.tenant_id` from the authorized principal and relies on forced PostgreSQL row-level security as a second isolation boundary.
7. Audit decisions using stable user/tenant/project identifiers and correlation IDs; never log bearer tokens or sensitive claims.

## Event contract

Platform's transactional outbox emits grant/revocation events with stable `eventId`, `tenantId`, `userId`, `projectCode`, `status`, and monotonic `entitlementVersion`. The PIMS consumer must:
- validate schema and project code (`PIMS`);
- deduplicate `eventId` and make processing idempotent;
- reject older entitlement versions so delayed events cannot restore revoked access;
- update the local projection transactionally;
- acknowledge the message only after commit;
- retry transient failures and send poison messages to a monitored dead-letter queue;
- expose projection lag, oldest pending event, processing failures and DLQ count as metrics.

Until the event consumer and projection are implemented and deployed, live revocation is **not complete**. Short token age is defense in depth, not a substitute for current entitlement checks.

## Required end-to-end tests

Use a real PostgreSQL instance with the PIMS schema and a non-production OIDC issuer/JWKS registration. Use two tenants and two users; no production credentials or customer data.

| Scenario | Expected result |
|---|---|
| Valid PIMS entitlement and `pims:read` permission | Read succeeds for the active tenant only |
| Valid identity without PIMS entitlement | 403; no data returned |
| PIMS entitlement revoked after token issuance | Denied within the documented revocation SLA, without waiting for token expiry |
| Tenant A token requests tenant B resource | 404/403 with zero rows disclosed |
| Tenant A request supplies tenant B ID in query/body/header | Server ignores caller scope and remains tenant A-scoped |
| Event delivered twice | Same projection result; no duplicate grant/audit side effect |
| Older grant arrives after newer revoke | Revocation remains effective |
| Projection/event stream is stale or unavailable beyond policy | Fail closed for protected operations |
| Connection pool reuses a DB connection across tenants | RLS context does not leak between transactions |
| Missing/invalid/expired JWT or wrong issuer/audience | 401; no database operation |
| Permission absent but entitlement active | 403 |
| Worker/file access across tenants | Denied independently of UI filtering |

## Release gates

- [ ] Platform event payload/schema and entitlement version semantics are confirmed.
- [ ] PIMS entitlement projection migration and idempotent event consumer are implemented.
- [ ] PIMS guard checks live projection and fails closed on stale projection.
- [ ] Platform grant/revoke -> outbox -> queue -> PIMS projection -> protected API path is tested end-to-end.
- [ ] Cross-tenant tests run against PostgreSQL/RLS in required CI.
- [ ] Revocation SLA and projection lag alert are approved.
- [ ] OIDC provider revocation/JWKS behavior is tested in a non-production tenant.
- [ ] No production rollout until all gates pass.
