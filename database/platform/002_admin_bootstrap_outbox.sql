-- Apply after 001_initial_schema.sql through a controlled migration runner.
-- This migration adds a one-time bootstrap state, DB-managed platform admin grants,
-- and a transactional outbox for at-least-once access-change event delivery.

CREATE TABLE IF NOT EXISTS platform_admin_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  permission_code text NOT NULL DEFAULT 'platform:admin',
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  reason text NOT NULL,
  granted_by_user_id uuid REFERENCES users(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_admin_grants_active
  ON platform_admin_grants(user_id, permission_code)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_platform_admin_grants_permission_status
  ON platform_admin_grants(permission_code, status);

CREATE TABLE IF NOT EXISTS platform_bootstrap_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES users(id)
);

INSERT INTO platform_bootstrap_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS access_change_outbox (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  tenant_id uuid,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_access_change_outbox_pending
  ON access_change_outbox(available_at, occurred_at)
  WHERE published_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_access_change_outbox_aggregate
  ON access_change_outbox(aggregate_type, aggregate_id, occurred_at DESC);
