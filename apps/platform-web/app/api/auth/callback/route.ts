import { randomBytes } from 'node:crypto';
import { authorizationCodeGrant } from 'openid-client';
import { NextResponse, type NextRequest } from 'next/server';
import {
  WEB_SESSION_TTL_SECONDS, checkRequestRateLimit, clearCookieValue, consumeOidcTransaction, getOidcConfiguration,
  getOidcRedirectUri, getPlatformWebBaseUrl, oidcTransactionCookieName, parseCookie,
  safeStringEqual, sessionCookieName, sessionCookieOptions, storeWebSession, logWebSecurityEvent,
} from '../../../../lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failureRedirect(reason: string = 'callback_failed') {
  logWebSecurityEvent('oidc.callback.rejected', { reason });
  const response = NextResponse.redirect(new URL('/?auth_error=callback', getPlatformWebBaseUrl()), 303);
  response.cookies.set(oidcTransactionCookieName, '', clearCookieValue(oidcTransactionCookieName));
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function GET(request: NextRequest) {
  try {
    const decision = await checkRequestRateLimit(request, 'oidc-callback', 20, 600);
    if (!decision.allowed) {
      logWebSecurityEvent('oidc.callback.rate_limited', { reason: 'client_window_exceeded', status: 429 });
      return NextResponse.json(
        { error: 'Too many authentication callbacks. Please try again later.' },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(decision.retryAfterSeconds) } },
      );
    }
  } catch {
    logWebSecurityEvent('oidc.callback.rate_limit_unavailable', { reason: 'redis_unavailable', status: 503 });
    return NextResponse.json({ error: 'Authentication service temporarily unavailable.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' },
    });
  }

  const incoming = new URL(request.url);
  const state = incoming.searchParams.get('state') || '';
  const stateCookie = parseCookie(request, oidcTransactionCookieName);
  if (!state || !stateCookie || !safeStringEqual(state, stateCookie)) return failureRedirect('state_cookie_mismatch');

  try {
    const transaction = await consumeOidcTransaction(state);
    if (!transaction) return failureRedirect('transaction_missing_expired_or_replayed');
    if (incoming.searchParams.has('error')) return failureRedirect('provider_returned_error');

    const configuration = await getOidcConfiguration();
    const callbackUrl = new URL(getOidcRedirectUri());
    callbackUrl.search = incoming.search;
    const tokenSet = await authorizationCodeGrant(configuration, callbackUrl, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });

    if (!tokenSet.access_token) throw new Error('No access token returned');
    const claims = tokenSet.claims();
    if (!claims || !claims.iss || !claims.sub) throw new Error('Validated issuer and subject claims are required');

    const sessionId = randomBytes(32).toString('base64url');
    const now = Date.now();
    await storeWebSession(sessionId, {
      accessToken: tokenSet.access_token,
      ...(tokenSet.refresh_token ? { refreshToken: tokenSet.refresh_token } : {}),
      ...(tokenSet.id_token ? { idToken: tokenSet.id_token } : {}),
      accessTokenExpiresAt: now + Math.max(1, Number(tokenSet.expires_in ?? 300)) * 1000,
      sessionExpiresAt: now + WEB_SESSION_TTL_SECONDS * 1000,
      user: {
        iss: claims.iss,
        sub: claims.sub,
        ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
        ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
        emailVerified: claims.email_verified === true,
      },
    });

    logWebSecurityEvent('oidc.login.completed');
    // Session fixation protection: always rotate to a fresh opaque, server-side session ID.
    const response = NextResponse.redirect(new URL('/', getPlatformWebBaseUrl()), 303);
    response.cookies.set(sessionCookieName(), sessionId, sessionCookieOptions());
    response.cookies.set(oidcTransactionCookieName, '', clearCookieValue(oidcTransactionCookieName));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch (error) {
    // Log only the error class; OAuth codes, access tokens and provider responses must never be logged.
    logWebSecurityEvent('oidc.callback.failed', { reason: error instanceof Error ? error.name : 'UnknownError' });
    return failureRedirect('callback_processing_failed');
  }
}
