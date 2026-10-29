-- Reference schema only. Apply through a controlled migration runner.
-- Authentication credentials remain in the configured OIDC provider.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_key text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','suspended','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_issuer text NOT NULL,
  oidc_subject text NOT NULL,
  email text,
  display_name text,
  status text NOT NULL CHECK (status IN ('invited','active','suspended','deactivated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oidc_issuer, oidc_subject)
);
CREATE TABLE tenant_users (
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('active','suspended','removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE TABLE projects (
  code text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE user_project_access (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  project_code text NOT NULL REFERENCES projects(code),
  status text NOT NULL CHECK (status IN ('granted','revoked')),
  entitlement_version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, project_code),
  FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_users(tenant_id, user_id)
);
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  project_code text REFERENCES projects(code),
  code text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, project_code, code)
);
CREATE TABLE permissions (
  code text PRIMARY KEY,
  description text NOT NULL
);
CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id),
  permission_code text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_id, permission_code)
);
CREATE TABLE user_project_roles (
  tenant_id uuid NOT NULL,
  user_id uuid NOT NULL,
  project_code text NOT NULL REFERENCES projects(code),
  role_id uuid NOT NULL REFERENCES roles(id),
  PRIMARY KEY (tenant_id, user_id, project_code, role_id),
  FOREIGN KEY (tenant_id, user_id, project_code)
    REFERENCES user_project_access(tenant_id, user_id, project_code)
);
CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  target_type text,
  target_id text,
  correlation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_users_user ON tenant_users(user_id);
CREATE INDEX idx_project_access_user_status ON user_project_access(user_id, status);
CREATE INDEX idx_audit_tenant_created ON audit_logs(tenant_id, created_at DESC);

INSERT INTO projects (code, name, status) VALUES
  ('PIMS','PIMS','active'), ('SALES','Sales','active'), ('BROKER','Broker','active'),
  ('SNAGGING','Snagging','active'), ('LEMS','LeMS','active'), ('CAFM','CAFM','active'),
  ('OA','OA','active'), ('FINANCE','Finance','active'), ('SUPPORT','Support','active')
ON CONFLICT (code) DO NOTHING;
