# First Platform Administrator Bootstrap Runbook

## Preconditions
- Apply migrations 001 and 002 to the Platform database.
- Configure the trusted OIDC issuer, JWKS URL and API audience.
- Provision the intended first administrator in the identity provider. The user must sign in and obtain a valid API access token.
- Generate a random secret with at least 32 characters and inject it securely as `PLATFORM_BOOTSTRAP_SECRET`.
- Set `PLATFORM_BOOTSTRAP_ENABLED=true` only for the bootstrap window.
- Redact the `x-platform-bootstrap-token` header from any proxy/access tracing.

## Bootstrap request
Send a POST request to `/api/v1/bootstrap/platform-admin` with the administrator's valid Bearer token and the bootstrap secret header. The first administrator identity is taken from the validated token issuer and subject; the request body cannot select another user.

Example (keep values in a secure local shell; do not paste secrets into chat or commit them):
```bash
curl -X POST "$PLATFORM_API_URL/api/v1/bootstrap/platform-admin" \
  -H "Authorization: Bearer $PLATFORM_ADMIN_ACCESS_TOKEN" \
  -H "x-platform-bootstrap-token: $PLATFORM_BOOTSTRAP_SECRET"
```

The operation is transactionally serialized using a database advisory lock and singleton state row. It fails if bootstrap is disabled, the secret is invalid, the migration is missing, an administrator already exists, or bootstrap has already completed.

## Immediately after success
1. Set `PLATFORM_BOOTSTRAP_ENABLED=false`.
2. Remove the bootstrap secret from the running workload and rotate/delete it in the secret store.
3. Confirm the first admin is listed by `GET /api/v1/admin/platform-admins`.
4. Create a second named Platform administrator through the protected API to avoid a single-person operational dependency.
5. Verify that a normal user without an active database grant receives 403 for administrative routes.

The bootstrap endpoint does not create an identity provider account or issue tokens. It maps the already-authenticated OIDC identity into Platform and grants the initial database-backed `platform:admin` permission.
