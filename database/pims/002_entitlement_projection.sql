-- Apply after database/pims/001_initial_schema.sql using the controlled migration runner.
-- The projection contains only the minimum authorization state needed by PIMS.
-- Platform remains the source of truth; PIMS does not query Platform tables.

CREATE TABLE pims_entitlement_projection (
  oidc_issuer text NOT NULL,
  oidc_subject text NOT NULL,
  tenant_id uuid NOT NULL,
  project_code text NOT NULL CHECK (project_code = 'PIMS'),
  entitlement_status text NOT NULL CHECK (entitlement_status IN ('granted', 'revoked')),
  entitlement_version bigint NOT NULL CHECK (entitlement_version > 0),
  source_event_id uuid NOT NULL,
  source_occurred_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (oidc_issuer, oidc_subject, tenant_id, project_code)
);

CREATE INDEX idx_pims_entitlement_tenant_status
  ON pims_entitlement_projection (tenant_id, entitlement_status);

CREATE TABLE pims_processed_access_events (
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pims_access_event_consumer_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  last_success_at timestamptz,
  last_event_id uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pims_access_event_consumer_state (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- Grant only the permissions required by the PIMS runtime role. Run after pims_app exists.
GRANT SELECT, INSERT, UPDATE ON TABLE pims_entitlement_projection TO pims_app;
GRANT SELECT, INSERT ON TABLE pims_processed_access_events TO pims_app;
GRANT SELECT, INSERT, UPDATE ON TABLE pims_access_event_consumer_state TO pims_app;
