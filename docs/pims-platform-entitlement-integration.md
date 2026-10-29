# PIMS Platform Entitlement Integration

## Implemented in repository

The PIMS API now includes a local entitlement projection and an optional SQS access-event consumer:
- Platform project-access grant/revoke events include the user's OIDC issuer and subject in the event payload (not tokens or credentials).
- PIMS validates the OIDC token, then requires an active local projection for the exact issuer, subject, tenant and PIMS project. Token `project_access` claims are not treated as the live source of truth.
- The consumer deduplicates stable event IDs, applies only strictly newer entitlement versions, commits projection and deduplication in one PostgreSQL transaction, and deletes an SQS message only after successful commit.
- Authorization fails closed if the projection database cannot be queried, the consumer is unhealthy, or the consumer heartbeat exceeds `PIMS_ENTITLEMENT_MAX_AGE_SECONDS`.
- Consumer is disabled by default. See `apps/pims-api/.env.example`.

## Required deployment sequence

1. Apply `database/pims/002_entitlement_projection.sql` after PIMS migration 001 using the controlled migration runner.
2. Deploy the Platform producer change so PIMS access events include `oidcIssuer` and `oidcSubject`. Configure the Platform outbox publisher to use an approved SQS queue.
3. Configure the PIMS workload identity with `sqs:ReceiveMessage`, `sqs:DeleteMessage`, and `sqs:GetQueueAttributes` only on the approved access-events queue. Configure a dead-letter queue, redrive policy and alarms for age, depth and DLQ count.
4. Run Platform migration `database/platform/004_pims_entitlement_snapshot_outbox.sql` once to enqueue a snapshot of current PIMS entitlements for active users/memberships/tenants. The regular outbox publisher delivers these events. Do not mark the PIMS projection healthy before the snapshot has been delivered and reconciled.
5. Start the PIMS event consumer with `PIMS_ACCESS_EVENTS_CONSUMER_ENABLED=true`, `PIMS_ACCESS_EVENTS_QUEUE_URL`, and `AWS_REGION`. Keep it disabled until migration 002 is applied and the queue/IAM/DLQ configuration is verified.
6. Reconcile projected grant/revoke counts and sample identities against Platform's authoritative entitlement report. Then, as a controlled operational action, mark the consumer state healthy and set its heartbeat timestamp to the current time:
   ```sql
   UPDATE pims_access_event_consumer_state
      SET healthy = true, updated_at = now()
    WHERE id = 1;
   ```
   Execute only after snapshot delivery and reconciliation are complete. This gate is deliberately manual; a queue consumer must not declare its own initial snapshot complete.
7. Measure actual revoke-to-deny latency. The default heartbeat limit is 60 seconds, but it is not a measured end-to-end SLA until queue delivery, consumer processing and protected API denial have been tested.
8. Prefer a separately deployed consumer workload and role over enabling the consumer on every API replica. The implementation is disabled by default and requires a reviewed workload/IAM design.

See [the standalone worker deployment guide](../apps/pims-api/worker-deployment.md) for the independent container command and workload identity requirements.

## Failure behavior

- Missing projection: deny with 403.
- Projection store unavailable, consumer not marked healthy, or stale heartbeat: fail closed with 503.
- Malformed or unsupported access event: do not delete the SQS message; mark the consumer unhealthy and leave it for retry/DLQ handling. A poison event must trigger reconciliation and manual recovery before readiness is restored.
- Duplicate event: no duplicate projection side effects.
- Older entitlement version: cannot overwrite a newer grant/revoke state.
- Consumer health does not automatically recover after a message-processing failure. Investigate/redrive the event and reconcile state before manually restoring `healthy=true`.

## Required end-to-end tests

Use a real PostgreSQL instance with the PIMS schema and a non-production OIDC issuer/JWKS registration. Use two tenants and two users; no production credentials or customer data.

| Scenario | Expected result |
|---|---|
| Valid PIMS entitlement and `pims:read` permission | Read succeeds for the active tenant only |
| Valid identity without PIMS entitlement | 403; no data returned |
| PIMS entitlement revoked after token issuance | Denied within the documented revocation SLA, without waiting for token expiry |
| Tenant A token requests tenant B resource | 404/403 with zero rows disclosed |
| Tenant A request supplies tenant B ID in query/body/header | Server ignores caller scope and remains tenant A-scoped |
| Event delivered twice | Same projection result; no duplicate side effects |
| Older grant arrives after newer revoke | Revocation remains effective |
| Consumer health becomes stale or unhealthy | 503/fail closed for projected active entitlements |
| Connection pool reuses a DB connection across tenants | RLS context does not leak between transactions |
| Missing/invalid/expired JWT or wrong issuer/audience | 401; no database operation |
| Permission absent but entitlement active | 403 |
| Worker/file access across tenants | Denied independently of UI filtering |

## Remaining release gates

- [ ] Apply migrations in a non-production environment and verify the one-time entitlement snapshot.
- [ ] Confirm the PostgreSQL-backed RLS/revocation integration suite passes in CI and extend it to a live OIDC/SQS environment.
- [ ] Run a real-issuer JWT verification suite in non-production CI.
- [ ] Test queue retries, DLQ redrive, duplicate/out-of-order delivery and consumer restart.
- [ ] Measure actual revoke-to-deny latency and approve the revocation SLA.
- [ ] Confirm tenant membership suspension/removal events are projected if tenant membership revocation must independently revoke access.
- [ ] Complete PIMS frontend OIDC session and protected API integration.
- [ ] Do not enable production access until all gates pass.
