-- Apply after PIMS migration 002 using the controlled migration runner.
-- Membership state is projected separately from project entitlement state.
CREATE TABLE pims_membership_projection (
  oidc_issuer text NOT NULL,
  oidc_subject text NOT NULL,
  tenant_id uuid NOT NULL,
  membership_status text NOT NULL CHECK (membership_status IN ('active', 'suspended', 'removed')),
  membership_version bigint NOT NULL CHECK (membership_version > 0),
  source_event_id uuid NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (oidc_issuer, oidc_subject, tenant_id)
);

CREATE INDEX idx_pims_membership_tenant_status
  ON pims_membership_projection (tenant_id, membership_status);

ALTER TABLE pims_membership_projection ENABLE ROW LEVEL SECURITY;
ALTER TABLE pims_membership_projection FORCE ROW LEVEL SECURITY;
CREATE POLICY pims_membership_tenant_isolation
  ON pims_membership_projection
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON TABLE pims_membership_projection TO pims_app;
