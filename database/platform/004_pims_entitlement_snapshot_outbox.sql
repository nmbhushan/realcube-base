-- One-time backfill migration for the PIMS entitlement projection.
-- Apply through the Platform migration runner after the PIMS consumer is deployed but
-- before marking the PIMS consumer state healthy. This emits a snapshot event for each
-- PIMS entitlement belonging to a currently active user, tenant and membership.
-- Do not re-run as an ad-hoc script; use the migration runner's applied-version ledger.

INSERT INTO access_change_outbox (
  event_type, aggregate_type, aggregate_id, tenant_id, payload, occurred_at, available_at
)
SELECT
  CASE WHEN a.status = 'granted'
       THEN 'platform.project_access.granted'
       ELSE 'platform.project_access.revoked'
  END,
  'user_project_access',
  a.tenant_id::text || ':' || a.user_id::text || ':PIMS:snapshot:' || a.entitlement_version::text,
  a.tenant_id,
  jsonb_build_object(
    'tenantId', a.tenant_id,
    'userId', a.user_id,
    'projectCode', 'PIMS',
    'status', a.status,
    'entitlementVersion', a.entitlement_version::text,
    'oidcIssuer', u.oidc_issuer,
    'oidcSubject', u.oidc_subject
  ),
  now(),
  now()
FROM user_project_access a
JOIN tenant_users tu
  ON tu.tenant_id = a.tenant_id
 AND tu.user_id = a.user_id
 AND tu.status = 'active'
JOIN users u
  ON u.id = a.user_id
 AND u.status = 'active'
JOIN tenants t
  ON t.id = a.tenant_id
 AND t.status = 'active'
WHERE a.project_code = 'PIMS'
ON CONFLICT DO NOTHING;
