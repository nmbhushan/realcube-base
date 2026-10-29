# Browser OIDC Authentication and Sessions

## Flow

1. The user chooses **Sign in with SSO**. The server discovers the configured OIDC issuer and redirects to its authorization endpoint using Authorization Code + PKCE (S256), a random state and a random nonce.
2. State, nonce and PKCE verifier live in Redis for five minutes. The browser only receives a short-lived HttpOnly, SameSite=Lax transaction cookie containing the state.
3. The callback checks the state cookie and consumes the Redis transaction exactly once before exchanging the authorization code. The `openid-client` library validates the authorization response and ID token, including issuer, nonce and PKCE checks.
4. The app generates a new opaque session ID. Only its SHA-256-derived key and the serialized session (including access/refresh tokens) are stored in Redis. The browser receives the ID only, in an HttpOnly cookie. Successful login rotates the ID to avoid session fixation.
5. The browser calls the same-origin `/api/platform/*` Backend-for-Frontend proxy. The proxy loads/refreshed the server-side session, attaches the bearer access token, and calls the fixed `PLATFORM_API_INTERNAL_URL`. It does not accept an upstream URL from the browser.
6. Unsafe proxy methods and logout require an exact `Origin` match and same-origin Fetch Metadata when present. Logout destroys the server session, clears the cookie, and performs OIDC RP-initiated logout when the provider advertises an end-session endpoint.

## Required configuration

Register the exact redirect URI and post-logout URI in the identity provider:
- `OIDC_REDIRECT_URI` — defaults locally to `http://localhost:3000/api/auth/callback`.
- `OIDC_POST_LOGOUT_REDIRECT_URI` — defaults locally to `http://localhost:3000/`.

Required web environment:
- `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`
- `PLATFORM_WEB_BASE_URL`
- `REDIS_URL`
- `PLATFORM_API_INTERNAL_URL`
- `OIDC_SCOPES` and optional `OIDC_RESOURCE` for the provider's Platform API access token.

The access token must be a JWT token whose audience matches the API's `OIDC_AUDIENCE`. Configure the provider's scopes/resource mapping accordingly. If the identity provider does not emit `email` and `email_verified: true` in the access token used by the invitation-acceptance endpoint, implement a provider-specific, authenticated UserInfo adapter before enabling invitation acceptance.

For production, set `SESSION_COOKIE_SECURE=true`, use an HTTPS `PLATFORM_WEB_BASE_URL`, a private TLS-protected Redis deployment, and secrets from a managed secret store. The Helm chart expects the frontend secret (default `enterprise-platform-web-env`) to contain Redis/OIDC secrets and issuer/redirect/scopes configuration. Do not commit values or live secrets.

## Session lifecycle

- Opaque 256-bit random session identifiers are rotated on successful login and hashed before they are used as Redis keys.
- Cookies have no Domain attribute and use HttpOnly, SameSite=Lax, and Secure in production mode.
- Session lifetime is fixed at eight hours; provider access tokens are refreshed server-side close to expiry with a distributed Redis lock to avoid concurrent refresh-token rotation.
- If token refresh fails after the existing access token expires, the server deletes the session and requests sign-in again.
- Redis is a runtime dependency across frontend replicas. The local Compose Redis intentionally has no persistence and is not a production configuration.
- The API still enforces its own OIDC validation, Platform admin grant, tenant scope and project-role rules; a successful browser login does not itself grant Platform admin permission.

## Known limits before rollout

This commits a server-side OIDC client/session foundation, not a provider-specific final deployment. Verify discovery/client authentication, scopes/resource/audience, email claim mapping, session refresh and RP-initiated logout against the selected IdP. Add provider-backed end-to-end tests, rate limiting, security headers/CSP, threat modeling and Redis HA/monitoring before production.
