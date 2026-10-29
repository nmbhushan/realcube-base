# PIMS Access-Event Consumer Deployment

The SQS consumer is packaged with the PIMS API code but has a standalone process entrypoint so it can run as an independent workload.

## Container command

Build the existing `apps/pims-api/Dockerfile` image, then override the container command to:

```bash
node dist/worker.main.js
```

Set these environment variables from the approved secret/configuration mechanism:

- `PIMS_DATABASE_URL`
- `PIMS_DATABASE_SSL=true` in production
- `PIMS_ACCESS_EVENTS_CONSUMER_ENABLED=true`
- `PIMS_ACCESS_EVENTS_QUEUE_URL`
- `AWS_REGION`
- `PIMS_ENTITLEMENT_MAX_AGE_SECONDS=60` (adjust only with an approved revocation objective)

Use a dedicated Kubernetes ServiceAccount/workload identity with only the required SQS receive/delete/queue-attribute permissions and PIMS database permissions. Do not attach these queue permissions to the frontend or to the API service account if the worker can have its own identity.

## Safe rollout order

1. Apply PIMS schema migrations 001 and 002.
2. Deploy the Platform producer change and configure the approved SQS queue, redrive policy and alarms.
3. Run the one-time Platform entitlement snapshot migration and wait for delivery.
4. Reconcile projected entitlement counts and samples against Platform.
5. Manually set `pims_access_event_consumer_state.healthy=true` and `updated_at=now()` only after reconciliation.
6. Start the worker. Verify its heartbeat stays fresh and a grant/revoke test changes PIMS authorization.
7. Keep the worker's environment disabled in API pods unless the reviewed deployment intentionally runs a consumer there.

The worker does not automatically mark itself healthy after a poison message or processing failure. Investigate the failure, reconcile projection state and explicitly restore readiness only after the event stream is trustworthy.
