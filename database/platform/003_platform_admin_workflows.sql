-- Apply after 001_initial_schema.sql and 002_admin_bootstrap_outbox.sql.
-- Invitations are bound to an OIDC identity only after the invitee authenticates.
-- Only a SHA-256 hash is stored; the raw bearer invite token is returned once.
CREATE TABLE IF NOT EXISTS platform_user_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  email text NOT NULL,
  display_name text,
  token_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_user_id uuid REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_by_user_id uuid REFERENCES users(id),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_invitations_pending_tenant_email
  ON platform_user_invitations(tenant_id, lower(email), expires_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_invitations_one_pending_per_tenant_email
  ON platform_user_invitations(tenant_id, lower(email))
  WHERE status = 'pending';

INSERT INTO permissions (code, description) VALUES
  ('project:read', 'Read project data'),
  ('project:write', 'Create and update project data'),
  ('project:manage-users', 'Manage project users and access'),
  ('project:manage-settings', 'Manage project configuration'),
  ('project:export', 'Export project data')
ON CONFLICT (code) DO NOTHING;
