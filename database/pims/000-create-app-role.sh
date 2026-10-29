#!/bin/sh
set -eu

: "${PIMS_APP_DB_PASSWORD:?PIMS_APP_DB_PASSWORD must be set for the local PIMS database}"

psql --username "${POSTGRES_USER:-postgres}" --dbname "${POSTGRES_DB:-pims_db}" \
  --set=app_password="${PIMS_APP_DB_PASSWORD}" <<'SQL'
SELECT format(
  'CREATE ROLE pims_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
  :'app_password'
)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pims_app')
\gexec

GRANT CONNECT ON DATABASE pims_db TO pims_app;
GRANT USAGE ON SCHEMA public TO pims_app;
SQL
