import { NextResponse, type NextRequest } from 'next/server';
import {
  checkRequestRateLimit, clearCookieValue, getStoredWebSession, sessionCookieName, logWebSecurityEvent,
} from '../../../../lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const decision = await checkRequestRateLimit(request, 'session-status', 120, 60);
    if (!decision.allowed) {
      return NextResponse.json({ authenticated: false, error: 'Too many session checks.' }, {
        status: 429,
        headers: { 'Cache-Control': 'no-store', 'Retry-After': String(decision.retryAfterSeconds) },
      });
    }
  } catch {
    logWebSecurityEvent('session.rate_limit_unavailable', { reason: 'redis_unavailable', status: 503 });
    return NextResponse.json({ authenticated: false, error: 'Session service temporarily unavailable.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' },
    });
  }

  try {
    const session = await getStoredWebSession(request);
    const response = NextResponse.json(
      session ? {
        authenticated: true,
        user: {
          sub: session.user.sub,
          issuer: session.user.iss,
          email: session.user.email,
          name: session.user.name,
          emailVerified: session.user.emailVerified,
        },
        expiresAt: new Date(session.sessionExpiresAt).toISOString(),
      } : { authenticated: false },
      { headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } },
    );
    if (!session) response.cookies.set(sessionCookieName(), '', clearCookieValue(sessionCookieName()));
    return response;
  } catch {
    logWebSecurityEvent('session.endpoint_unavailable', { reason: 'session_store_or_refresh_failed', status: 503 });
    return NextResponse.json(
      { authenticated: false, error: 'Session store is unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
