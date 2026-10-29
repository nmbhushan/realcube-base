-- PIMS pilot-owned schema. Apply using the approved migration runner in shared environments.
-- The pims_app role must be provisioned separately and must not be a superuser or BYPASSRLS role.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE pims_work_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  title varchar(200) NOT NULL,
  description text,
  status varchar(24) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done')),
  created_by_issuer text NOT NULL,
  created_by_subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pims_work_items_tenant_created
  ON pims_work_items (tenant_id, created_at DESC);

ALTER TABLE pims_work_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pims_work_items FORCE ROW LEVEL SECURITY;

CREATE POLICY pims_work_items_tenant_isolation
  ON pims_work_items
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE pims_work_items TO pims_app;
