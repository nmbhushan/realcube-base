-- Add a monotonic version to each tenant membership and enqueue a one-time
-- snapshot so the PIMS projection can be initialized before readiness is enabled.
ALTER TABLE tenant_users
  ADD COLUMN IF NOT EXISTS membership_version bigint NOT NULL DEFAULT 1
  CHECK (membership_version > 0);

INSERT INTO access_change_outbox (
  event_type, aggregate_type, aggregate_id, tenant_id, payload, occurred_at, available_at
)
SELECT
  CASE m.status
    WHEN 'active' THEN 'platform.tenant_membership.activated'
    WHEN 'suspended' THEN 'platform.tenant_membership.suspended'
    ELSE 'platform.tenant_membership.removed'
  END,
  'tenant_membership',
  m.tenant_id::text || ':' || m.user_id::text || ':membership-snapshot:' || m.membership_version::text,
  m.tenant_id,
  jsonb_build_object(
    'tenantId', m.tenant_id,
    'userId', m.user_id,
    'status', m.status,
    'membershipVersion', m.membership_version::text,
    'oidcIssuer', u.oidc_issuer,
    'oidcSubject', u.oidc_subject
  ),
  now(),
  now()
FROM tenant_users m
JOIN users u ON u.id = m.user_id
WHERE u.status = 'active';
