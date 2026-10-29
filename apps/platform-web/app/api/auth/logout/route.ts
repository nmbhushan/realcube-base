import * as oidc from 'openid-client';
import { NextResponse, type NextRequest } from 'next/server';
import {
  clearCookieValue, destroyWebSession, ensureSameOriginMutation, getOidcConfiguration,
  getPlatformWebBaseUrl, getPostLogoutRedirectUri, getRedisClient, parseCookie,
  sessionCookieName, sessionRedisKeyForId,
  type StoredWebSession,
} from '../../../../lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!ensureSameOriginMutation(request)) {
    return NextResponse.json({ error: 'Same-origin logout required' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const sessionId = parseCookie(request, sessionCookieName());
  let session: StoredWebSession | null = null;
  try {
    if (sessionId) {
      const redis = await getRedisClient();
      const raw = await redis.get(sessionRedisKeyForId(sessionId));
      if (raw) {
        try { session = JSON.parse(raw) as StoredWebSession; } catch { session = null; }
      }
      await destroyWebSession(sessionId);
    }
  } catch {
    // Clear the browser cookie even if the store is unavailable; no token is sent to the browser.
    const response = NextResponse.redirect(new URL('/', getPlatformWebBaseUrl()), 303);
    response.cookies.set(sessionCookieName(), '', clearCookieValue(sessionCookieName()));
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }

  let destination = new URL(getPlatformWebBaseUrl());
  if (session?.idToken) {
    try {
      const configuration = await getOidcConfiguration();
      destination = oidc.buildEndSessionUrl(configuration, {
        id_token_hint: session.idToken,
        post_logout_redirect_uri: getPostLogoutRedirectUri(),
      });
    } catch {
      // Local session logout remains effective if the provider has no RP-initiated logout endpoint.
    }
  }

  const response = NextResponse.redirect(destination, 303);
  response.cookies.set(sessionCookieName(), '', clearCookieValue(sessionCookieName()));
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}
