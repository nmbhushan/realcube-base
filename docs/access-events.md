# Durable Access-Change Events

## Write path
Access grant/revocation, platform-admin grant/revocation, tenant creation, tenant membership creation, and bootstrap write an outbox row in the same PostgreSQL transaction as the state change and audit record. If the transaction rolls back, the event rolls back too.

## Publisher
The optional outbox publisher claims batches using an atomic PostgreSQL update with `FOR UPDATE SKIP LOCKED`, then sends messages to SQS. Enable it only in a worker deployment by setting:
- `OUTBOX_PUBLISHER_ENABLED=true`
- `ACCESS_EVENTS_QUEUE_URL=<queue URL>`
- `PLATFORM_DATABASE_URL=<Platform database connection>`
- `AWS_REGION=<deployment region>`

The worker uses the workload's AWS identity. Grant only `sqs:SendMessage` for the specific queue. Do not place AWS access keys in environment variables or source control.

## Delivery semantics
The publisher provides **at-least-once** delivery, not exactly-once. A worker can send a message successfully and fail before recording `published_at`; retries can produce duplicates. Every consumer must deduplicate on the stable `eventId` and be idempotent. FIFO SQS queues use the event ID for deduplication and aggregate ID for message grouping, but consumers should still be idempotent.

Failures clear the claim, record a bounded error string, and schedule exponential backoff. Unpublished events remain in PostgreSQL. Monitor pending-event count, oldest pending age, attempt count, and publish failures. Add a redrive/operator runbook before production.

## Example event
```json
{
  "eventId": "uuid",
  "eventType": "platform.project_access.revoked",
  "aggregateType": "user_project_access",
  "aggregateId": "tenant-id:user-id:FINANCE",
  "tenantId": "tenant-id",
  "payload": {
    "tenantId": "tenant-id",
    "userId": "user-id",
    "projectCode": "FINANCE",
    "status": "revoked",
    "entitlementVersion": "2"
  },
  "occurredAt": "timestamp"
}
```

Do not rely on an asynchronous event as the sole enforcement control for high-risk operations. Project APIs must still enforce local authorization and use a documented entitlement freshness/revocation strategy.
