# Platform Administration Workflows

## Invitation-based onboarding

Platform admins create an invitation for a tenant and a verified email address through `POST /api/v1/admin/invitations`. The API returns a one-time token once; only a SHA-256 hash is stored. The admin console builds an invitation URL using a URL fragment (`/#invite=...`) so the browser does not send the bearer token as part of the HTTP request path. Deliver the link through an approved channel; automated email delivery is not configured in this phase.

The invitee must authenticate through the trusted OIDC provider and call `POST /api/v1/invitations/accept` with a valid bearer token and the invitation token. The API requires `iss`, `sub`, an email claim and `email_verified: true`, and enforces an exact case-insensitive match between the signed-in verified email and invitation. The OIDC issuer/subject mapping is created only after that check. Invitations are one-time, expire after a configurable number of days (default seven), and are serialized for each tenant/email pair.

Do not send OIDC access tokens to the inviter or include them in invitation links. The Platform UI holds the access token in page memory only; this is a development/admin console pattern, not a substitute for production OIDC authorization-code flow with a hardened session/BFF.

## Tenant-scoped roles

- `GET /api/v1/admin/permissions`: list the seeded permission catalogue.
- `GET /api/v1/admin/roles?tenantId=...&projectCode=...`: list roles scoped to the selected tenant and project, with permission codes.
- `POST /api/v1/admin/roles`: create a tenant/project-scoped role from known permission codes.
- `GET /api/v1/admin/user-project-roles?tenantId=...`: view assignments for that tenant.
- `POST /api/v1/admin/user-project-roles`: assign or revoke a role.

A member must be active in the tenant and must have a currently granted project entitlement before a role can be assigned. Role lookup validates the exact tenant and project scope. Revoking project access also clears role assignments for that user/project in the same transaction. Every role and invitation mutation writes audit and outbox records atomically with its state change.

## Migration

Migration `003_platform_admin_workflows.sql` follows migrations 001 and 002. The local Compose initializer runs all three files only for a fresh PostgreSQL data volume. Existing databases must be backed up and upgraded using the approved migration job; do not delete a volume to force initialization.

## Validation and remaining production work

Unit tests cover the identity/email binding checks and verify that roles cannot be assigned without an active project grant. Production rollout still requires end-to-end tests against the chosen OIDC provider and PostgreSQL, email delivery through an approved provider, a production browser login/session strategy, rate limits and abuse monitoring, and infrastructure/security review.
