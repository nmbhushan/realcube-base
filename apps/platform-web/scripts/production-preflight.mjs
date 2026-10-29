import { pathToFileURL } from 'node:url';

const PLACEHOLDER_PATTERN = /^(?:YOUR_|REPLACE_WITH_|CHANGE_ME$|CHANGEME$|TODO$)/i;

function addIssue(issues, name, message) {
  issues.push(`${name}: ${message}`);
}

function parseUrl(value, name, issues) {
  if (!value) {
    addIssue(issues, name, 'must be set');
    return undefined;
  }
  try {
    return new URL(value);
  } catch {
    addIssue(issues, name, 'must be a valid absolute URL');
    return undefined;
  }
}

function isPlaceholder(value) {
  return !value || PLACEHOLDER_PATTERN.test(value.trim());
}

/**
 * Returns only safe, configuration-key-oriented errors. Never includes environment values,
 * because those values can be credentials, internal hostnames or tokens.
 */
export function validateProductionEnvironment(env = process.env) {
  if (env.PLATFORM_ENV !== 'production') return [];

  const issues = [];
  const webUrl = parseUrl(env.PLATFORM_WEB_BASE_URL, 'PLATFORM_WEB_BASE_URL', issues);
  if (webUrl) {
    if (webUrl.protocol !== 'https:') addIssue(issues, 'PLATFORM_WEB_BASE_URL', 'must use HTTPS');
    if (webUrl.pathname !== '/' || webUrl.search || webUrl.hash || webUrl.username || webUrl.password) {
      addIssue(issues, 'PLATFORM_WEB_BASE_URL', 'must be an origin without a path, query, fragment or credentials');
    }
  }

  if (env.SESSION_COOKIE_SECURE !== 'true') {
    addIssue(issues, 'SESSION_COOKIE_SECURE', 'must be true in production');
  }

  if (isPlaceholder(env.OIDC_CLIENT_ID)) addIssue(issues, 'OIDC_CLIENT_ID', 'must be configured');
  if (isPlaceholder(env.OIDC_CLIENT_SECRET)) addIssue(issues, 'OIDC_CLIENT_SECRET', 'must be configured through a secret store');

  const issuer = parseUrl(env.OIDC_ISSUER_URL, 'OIDC_ISSUER_URL', issues);
  if (issuer) {
    if (issuer.protocol !== 'https:') addIssue(issues, 'OIDC_ISSUER_URL', 'must use HTTPS in production');
    if (issuer.username || issuer.password || issuer.search || issuer.hash) {
      addIssue(issues, 'OIDC_ISSUER_URL', 'must not contain credentials, query parameters or a fragment');
    }
    if (isPlaceholder(issuer.hostname)) addIssue(issues, 'OIDC_ISSUER_URL', 'must not contain an example/placeholder host');
  }

  const callback = parseUrl(env.OIDC_REDIRECT_URI, 'OIDC_REDIRECT_URI', issues);
  if (callback) {
    if (callback.protocol !== 'https:') addIssue(issues, 'OIDC_REDIRECT_URI', 'must use HTTPS');
    if (callback.pathname !== '/api/auth/callback' || callback.search || callback.hash ||
        callback.username || callback.password) {
      addIssue(issues, 'OIDC_REDIRECT_URI', 'must be the exact /api/auth/callback URL');
    }
    if (webUrl && callback.origin !== webUrl.origin) {
      addIssue(issues, 'OIDC_REDIRECT_URI', 'must have the same origin as PLATFORM_WEB_BASE_URL');
    }
  }

  const postLogout = parseUrl(
    env.OIDC_POST_LOGOUT_REDIRECT_URI,
    'OIDC_POST_LOGOUT_REDIRECT_URI',
    issues,
  );
  if (postLogout) {
    if (postLogout.protocol !== 'https:') addIssue(issues, 'OIDC_POST_LOGOUT_REDIRECT_URI', 'must use HTTPS');
    if (postLogout.pathname !== '/' || postLogout.search || postLogout.hash ||
        postLogout.username || postLogout.password) {
      addIssue(issues, 'OIDC_POST_LOGOUT_REDIRECT_URI', 'must be the exact application origin root');
    }
    if (webUrl && postLogout.origin !== webUrl.origin) {
      addIssue(issues, 'OIDC_POST_LOGOUT_REDIRECT_URI', 'must have the same origin as PLATFORM_WEB_BASE_URL');
    }
  }

  const redis = parseUrl(env.REDIS_URL, 'REDIS_URL', issues);
  if (redis) {
    if (redis.protocol !== 'rediss:') addIssue(issues, 'REDIS_URL', 'must use rediss:// TLS in production');
    if (!redis.hostname || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(redis.hostname.toLowerCase())) {
      addIssue(issues, 'REDIS_URL', 'must use the managed/private Redis endpoint, not loopback');
    }
  }

  if (!env.RATE_LIMIT_CLIENT_IP_HEADER ||
      !/^[a-z0-9-]{1,64}$/i.test(env.RATE_LIMIT_CLIENT_IP_HEADER)) {
    addIssue(issues, 'RATE_LIMIT_CLIENT_IP_HEADER', 'must name a trusted ingress-controlled HTTP header');
  }

  const apiUrl = parseUrl(env.PLATFORM_API_INTERNAL_URL, 'PLATFORM_API_INTERNAL_URL', issues);
  if (apiUrl) {
    if (!['https:', 'http:'].includes(apiUrl.protocol)) {
      addIssue(issues, 'PLATFORM_API_INTERNAL_URL', 'must use HTTP or HTTPS');
    }
    if (apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
      addIssue(issues, 'PLATFORM_API_INTERNAL_URL', 'must not contain credentials, query parameters or a fragment');
    }
    if (['localhost', '127.0.0.1', '::1', '[::1]'].includes(apiUrl.hostname.toLowerCase())) {
      addIssue(issues, 'PLATFORM_API_INTERNAL_URL', 'must address the API service, not loopback');
    }
  }

  if (env.OIDC_ISSUER_URL && env.OIDC_JWKS_URL) {
    const jwks = parseUrl(env.OIDC_JWKS_URL, 'OIDC_JWKS_URL', issues);
    if (jwks) {
      if (jwks.protocol !== 'https:') addIssue(issues, 'OIDC_JWKS_URL', 'must use HTTPS in production');
      if (jwks.username || jwks.password || jwks.search || jwks.hash) {
        addIssue(issues, 'OIDC_JWKS_URL', 'must not contain credentials, query parameters or a fragment');
      }
      if (isPlaceholder(jwks.hostname)) addIssue(issues, 'OIDC_JWKS_URL', 'must not contain an example/placeholder host');
    }
  } else if (!env.OIDC_JWKS_URL) {
    addIssue(issues, 'OIDC_JWKS_URL', 'must be configured for API JWT verification');
  }

  if (isPlaceholder(env.OIDC_AUDIENCE)) addIssue(issues, 'OIDC_AUDIENCE', 'must be configured');
  return [...new Set(issues)];
}

function runAsScript() {
  const issues = validateProductionEnvironment();
  if (issues.length) {
    console.error('Production configuration validation failed:');
    for (const issue of issues) console.error(`- ${issue}`);
    console.error('No configuration values were printed. Fix the named variables before starting the production web container.');
    process.exitCode = 1;
    return;
  }
  console.log(envModeMessage());
}

function envModeMessage() {
  return process.env.PLATFORM_ENV === 'production'
    ? 'Production configuration validation passed.'
    : 'Production preflight skipped (PLATFORM_ENV is not production).';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAsScript();
}
