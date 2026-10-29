import { randomNonce, randomPKCECodeVerifier, randomState, calculatePKCECodeChallenge, buildAuthorizationUrl } from 'openid-client';
import { NextResponse, type NextRequest } from 'next/server';
import {
  checkRequestRateLimit, getOidcConfiguration, getOidcRedirectUri, getPlatformWebBaseUrl, logWebSecurityEvent,
  oidcTransactionCookieName, storeOidcTransaction, transactionCookieOptions,
} from '../../../../lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const decision = await checkRequestRateLimit(request, 'oidc-login', 10, 600);
    if (!decision.allowed) {
      logWebSecurityEvent('oidc.login.rate_limited', { reason: 'client_window_exceeded', status: 429 });
      return NextResponse.json(
        { error: 'Too many sign-in attempts. Please try again later.' },
        { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(decision.retryAfterSeconds) } },
      );
    }
  } catch {
    logWebSecurityEvent('oidc.login.rate_limit_unavailable', { reason: 'redis_unavailable', status: 503 });
    return NextResponse.json({ error: 'Authentication service temporarily unavailable.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' },
    });
  }

  try {
    const configuration = await getOidcConfiguration();
    const state = randomState();
    const nonce = randomNonce();
    const codeVerifier = randomPKCECodeVerifier();
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    await storeOidcTransaction({ state, nonce, codeVerifier, createdAt: Date.now() });

    const parameters: Record<string, string> = {
      redirect_uri: getOidcRedirectUri(),
      scope: process.env.OIDC_SCOPES || 'openid email profile offline_access',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      nonce,
    };
    const resource = process.env.OIDC_RESOURCE;
    if (resource) parameters.resource = resource;

    logWebSecurityEvent('oidc.login.started');
    const response = NextResponse.redirect(buildAuthorizationUrl(configuration, parameters), 302);
    response.cookies.set(oidcTransactionCookieName, state, transactionCookieOptions());
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    logWebSecurityEvent('oidc.login.start_failed', { reason: 'issuer_or_transaction_store_unavailable' });
    const response = NextResponse.redirect(new URL('/?auth_error=configuration', getPlatformWebBaseUrl()), 303);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
}
