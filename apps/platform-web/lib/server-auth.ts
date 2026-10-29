import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createClient } from 'redis';
import * as oidc from 'openid-client';

export const OIDC_TRANSACTION_TTL_SECONDS = 300;
export const WEB_SESSION_TTL_SECONDS = 8 * 60 * 60;
export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

export function getTrustedRateLimitSubject(request: Request): string {
  const configured = process.env.RATE_LIMIT_CLIENT_IP_HEADER ||
    (process.env.NODE_ENV === 'production' ? '' : 'x-real-ip');
  if (!configured || !/^[a-z0-9-]{1,64}$/i.test(configured)) {
    throw new Error('RATE_LIMIT_CLIENT_IP_HEADER must be configured to a trusted ingress header');
  }
  const headerName = configured.toLowerCase();
  const raw = request.headers.get(headerName);
  if (!raw) return 'unknown-client';
  let candidate = raw.trim();
  // ALB appends the observed source address to X-Forwarded-For; use the last entry.
  if (headerName === 'x-forwarded-for') {
    candidate = candidate.split(',').map(part => part.trim()).filter(Boolean).at(-1) ?? '';
  }
  if (!candidate || candidate.length > 128 || /[\r\n\u0000-\u001f]/.test(candidate)) return 'unknown-client';
  return candidate;
}

export async function consumeRateLimit(
  bucket: string,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitDecision> {
  if (!/^[a-z][a-z0-9_-]{1,48}$/.test(bucket)) throw new Error('Invalid rate-limit bucket');
  if (!subject || subject.length > 512) throw new Error('Invalid rate-limit subject');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw new Error('Invalid rate limit');
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400) {
    throw new Error('Invalid rate-limit window');
  }
  const redis = await getRedisClient();
  const subjectHash = createHash('sha256').update(subject).digest('hex');
  const key = 'realcube:platform:rate-limit:' + bucket + ':' + subjectHash;
  const raw = await redis.eval(RATE_LIMIT_SCRIPT, { keys: [key], arguments: [String(windowSeconds)] });
  if (!Array.isArray(raw) || raw.length < 2) throw new Error('Unexpected Redis rate-limit result');
  const count = Number(raw[0]);
  const ttl = Number(raw[1]);
  if (!Number.isFinite(count) || count < 1 || !Number.isFinite(ttl)) throw new Error('Invalid Redis rate-limit result');
  return {
    allowed: count <= limit,
    limit,
    remaining: Math.max(0, limit - count),
    retryAfterSeconds: count <= limit ? 0 : Math.max(1, ttl),
  };
}

export async function checkRequestRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowSeconds: number,
  subjectOverride?: string,
): Promise<RateLimitDecision> {
  return consumeRateLimit(bucket, subjectOverride ?? getTrustedRateLimitSubject(request), limit, windowSeconds);
}


export function logWebSecurityEvent(
  event: string,
  details: { reason?: string; status?: number; durationMs?: number } = {},
): void {
  const safeEvent = /^[a-z][a-z0-9_.-]{2,80}$/.test(event) ? event : 'platform_web.event';
  const reason = details.reason && /^[A-Za-z0-9_.-]{1,64}$/.test(details.reason)
    ? details.reason
    : undefined;
  const status = Number.isInteger(details.status) && details.status! >= 100 && details.status! <= 599
    ? details.status
    : undefined;
  const durationMs = Number.isFinite(details.durationMs) && details.durationMs! >= 0
    ? Math.round(details.durationMs!)
    : undefined;
  const entry = {
    timestamp: new Date().toISOString(),
    level: safeEvent.includes('failed') || safeEvent.includes('rejected') ? 'warn' : 'info',
    component: 'platform-web',
    event: safeEvent,
    ...(reason ? { reason } : {}),
    ...(status ? { status } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
  const output = JSON.stringify(entry);
  if (entry.level === 'warn') console.warn(output);
  else console.info(output);
}

export type SessionUser = {
  sub: string;
  iss: string;
  email?: string;
  name?: string;
  emailVerified: boolean;
};

export type StoredWebSession = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accessTokenExpiresAt: number;
  sessionExpiresAt: number;
  user: SessionUser;
};

export type OidcTransaction = {
  state: string;
  nonce: string;
  codeVerifier: string;
  createdAt: number;
};

type RedisClient = ReturnType<typeof createClient>;
let redisInstance: RedisClient | undefined;
let redisConnecting: Promise<void> | undefined;
let oidcConfigPromise: ReturnType<typeof oidc.discovery> | undefined;

export function isSecureCookieMode(): boolean {
  if (process.env.SESSION_COOKIE_SECURE === 'true') return true;
  if (process.env.SESSION_COOKIE_SECURE === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

export function sessionCookieName(): string {
  return isSecureCookieMode() ? '__Host-rc_session' : 'rc_session';
}

export const oidcTransactionCookieName = 'rc_oidc_tx';

export function getPlatformWebBaseUrl(): string {
  const raw = process.env.PLATFORM_WEB_BASE_URL ||
    (process.env.NODE_ENV === 'production' && process.env.SESSION_COOKIE_SECURE !== 'false'
      ? ''
      : 'http://localhost:3000');
  if (!raw) throw new Error('PLATFORM_WEB_BASE_URL must be configured');
  const url = new URL(raw);
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('PLATFORM_WEB_BASE_URL must be an origin without path, query or credentials');
  }
  if (isSecureCookieMode() && url.protocol !== 'https:') {
    throw new Error('HTTPS is required when secure session cookies are enabled');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Non-local Platform URLs must use HTTPS');
  }
  return url.origin;
}

export function getOidcRedirectUri(): string {
  const baseUrl = new URL(getPlatformWebBaseUrl());
  const configured = process.env.OIDC_REDIRECT_URI;
  const redirectUri = configured || new URL('/api/auth/callback', baseUrl).toString();
  const url = new URL(redirectUri);
  if (url.origin !== baseUrl.origin || url.pathname !== '/api/auth/callback' ||
      url.search || url.hash || url.username || url.password) {
    throw new Error('OIDC_REDIRECT_URI must be the same-origin /api/auth/callback URL');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('OIDC_REDIRECT_URI must use HTTPS outside localhost development');
  }
  return url.toString();
}

export function getPostLogoutRedirectUri(): string {
  const configured = process.env.OIDC_POST_LOGOUT_REDIRECT_URI || getPlatformWebBaseUrl() + '/';
  const url = new URL(configured);
  const base = new URL(getPlatformWebBaseUrl());
  if (url.origin !== base.origin || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('OIDC_POST_LOGOUT_REDIRECT_URI must be the Platform web origin root');
  }
  return url.toString();
}

export async function getRedisClient(): Promise<RedisClient> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is required for server-managed Platform sessions');
  if (!redisInstance) {
    redisInstance = createClient({ url: redisUrl });
    redisInstance.on('error', () => {
      // Do not log connection URLs or session data.
      logWebSecurityEvent('session_store.connection_failed');
    });
  }
  if (!redisInstance.isOpen) {
    if (!redisConnecting) {
      redisConnecting = redisInstance.connect()
        .then(() => undefined)
        .finally(() => { redisConnecting = undefined; });
    }
    await redisConnecting;
  }
  return redisInstance;
}

export async function getOidcConfiguration() {
  if (!oidcConfigPromise) {
    const issuer = process.env.OIDC_ISSUER_URL;
    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;
    if (!issuer || !clientId || !clientSecret) {
      throw new Error('OIDC_ISSUER_URL, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET must be configured');
    }
    const issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== 'https:' &&
        !(process.env.NODE_ENV !== 'production' &&
          (issuerUrl.hostname === 'localhost' || issuerUrl.hostname === '127.0.0.1'))) {
      throw new Error('The OIDC issuer must use HTTPS outside localhost development');
    }
    oidcConfigPromise = oidc.discovery(issuerUrl, clientId, clientSecret).catch((error: unknown) => {
      oidcConfigPromise = undefined;
      throw error;
    });
  }
  return oidcConfigPromise;
}

export function parseCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      try { return decodeURIComponent(value); } catch { return undefined; }
    }
  }
  return undefined;
}

export function safeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'utf8');
  const rightBytes = Buffer.from(right, 'utf8');
  return leftBytes.length > 0 && leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isSecureCookieMode(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: WEB_SESSION_TTL_SECONDS,
  };
}

export function transactionCookieOptions() {
  return {
    httpOnly: true,
    secure: isSecureCookieMode(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: OIDC_TRANSACTION_TTL_SECONDS,
  };
}

function sessionKey(sessionId: string): string {
  const digest = createHash('sha256').update(sessionId).digest('hex');
  return 'realcube:platform:web-session:' + digest;
}

export function sessionRedisKeyForId(sessionId: string): string {
  return sessionKey(sessionId);
}

function transactionKey(state: string): string {
  return 'realcube:platform:oidc-transaction:' + state;
}

export async function storeOidcTransaction(transaction: OidcTransaction): Promise<void> {
  const redis = await getRedisClient();
  const result = await redis.set(
    transactionKey(transaction.state),
    JSON.stringify(transaction),
    { EX: OIDC_TRANSACTION_TTL_SECONDS, NX: true },
  );
  if (result !== 'OK') throw new Error('Could not reserve OIDC transaction state');
}

export async function consumeOidcTransaction(state: string): Promise<OidcTransaction | null> {
  const redis = await getRedisClient();
  const value = await redis.getDel(transactionKey(state));
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as OidcTransaction;
    if (parsed.state !== state || Date.now() - parsed.createdAt > OIDC_TRANSACTION_TTL_SECONDS * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function storeWebSession(sessionId: string, session: StoredWebSession): Promise<void> {
  const redis = await getRedisClient();
  const remainingSeconds = Math.floor((session.sessionExpiresAt - Date.now()) / 1000);
  if (remainingSeconds <= 0) throw new Error('Cannot store an expired Platform session');
  await redis.set(sessionKey(sessionId), JSON.stringify(session), { EX: remainingSeconds });
}

async function readWebSession(sessionId: string): Promise<StoredWebSession | null> {
  const redis = await getRedisClient();
  const raw = await redis.get(sessionKey(sessionId));
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as StoredWebSession;
    if (!session.accessToken || !session.user?.sub || !session.user?.iss ||
        session.sessionExpiresAt <= Date.now()) {
      await redis.del(sessionKey(sessionId));
      return null;
    }
    return session;
  } catch {
    await redis.del(sessionKey(sessionId));
    return null;
  }
}

export async function destroyWebSession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  const redis = await getRedisClient();
  await redis.del(sessionKey(sessionId));
}

export async function getStoredWebSession(request: Request): Promise<StoredWebSession | null> {
  const sessionId = parseCookie(request, sessionCookieName());
  if (!sessionId || sessionId.length < 32 || sessionId.length > 128) return null;
  const existing = await readWebSession(sessionId);
  if (!existing) return null;
  const now = Date.now();
  if (existing.accessTokenExpiresAt > now + 60_000) return existing;
  if (!existing.refreshToken) {
    if (existing.accessTokenExpiresAt > now) return existing;
    await destroyWebSession(sessionId);
    logWebSecurityEvent('session.expired', { reason: 'access_token_expired_without_refresh' });
    return null;
  }

  const redis = await getRedisClient();
  const lockKey = sessionKey(sessionId) + ':refresh-lock';
  const lockValue = randomBytes(16).toString('hex');
  const lock = await redis.set(lockKey, lockValue, { NX: true, EX: 15 });
  if (lock !== 'OK') {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const latest = await readWebSession(sessionId);
      if (latest && latest.accessTokenExpiresAt > Date.now() + 30_000) return latest;
    }
    const latest = await readWebSession(sessionId);
    return latest && latest.accessTokenExpiresAt > Date.now() ? latest : null;
  }

  try {
    const latest = await readWebSession(sessionId);
    if (!latest) return null;
    if (latest.accessTokenExpiresAt > Date.now() + 60_000) return latest;
    if (!latest.refreshToken) return latest.accessTokenExpiresAt > Date.now() ? latest : null;

    const configuration = await getOidcConfiguration();
    const tokenSet = await oidc.refreshTokenGrant(configuration, latest.refreshToken);
    if (!tokenSet.access_token) throw new Error('OIDC refresh did not return an access token');
    const claims = tokenSet.id_token ? tokenSet.claims() : undefined;
    const updated: StoredWebSession = {
      ...latest,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token || latest.refreshToken,
      idToken: tokenSet.id_token || latest.idToken,
      accessTokenExpiresAt: Date.now() + Math.max(1, Number(tokenSet.expires_in ?? 300)) * 1000,
      user: claims?.sub && claims.iss ? {
        sub: claims.sub,
        iss: claims.iss,
        ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
        ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
        emailVerified: claims.email_verified === true,
      } : latest.user,
    };
    await storeWebSession(sessionId, updated);
    logWebSecurityEvent('session.access_token_refreshed');
    return updated;
  } catch (error) {
    logWebSecurityEvent('session.refresh_failed', { reason: error instanceof Error ? error.name : 'UnknownError' });
    const latest = await readWebSession(sessionId);
    if (latest && latest.accessTokenExpiresAt > Date.now()) return latest;
    await destroyWebSession(sessionId);
    logWebSecurityEvent('session.expired', { reason: 'refresh_failed_after_access_expiry' });
    return null;
  } finally {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      { keys: [lockKey], arguments: [lockValue] },
    ).catch(() => undefined);
  }
}

export function clearCookieValue(name: string) {
  return {
    httpOnly: true,
    secure: isSecureCookieMode(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  };
}

export function ensureSameOriginMutation(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  let expectedOrigin: string;
  try { expectedOrigin = new URL(getPlatformWebBaseUrl()).origin; } catch { return false; }
  if (origin !== expectedOrigin) return false;
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return true;
}
