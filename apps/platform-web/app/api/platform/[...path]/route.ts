import { NextResponse, type NextRequest } from 'next/server';
import {
  clearCookieValue, destroyWebSession, ensureSameOriginMutation, getStoredWebSession,
  parseCookie, sessionCookieName,
} from '../../../../lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  const method = request.method.toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return NextResponse.json({ message: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST, PUT, PATCH, DELETE' } });
  }
  if (!['GET'].includes(method) && !ensureSameOriginMutation(request)) {
    return NextResponse.json({ message: 'Same-origin request required' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const { path } = await context.params;
  if (!Array.isArray(path) || path.length === 0 || path.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) {
    return NextResponse.json({ message: 'Invalid Platform API path' }, { status: 400 });
  }

  let session;
  try {
    session = await getStoredWebSession(request);
  } catch {
    return NextResponse.json({ message: 'Session store is unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!session) {
    const response = NextResponse.json({ message: 'Authentication required' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(sessionCookieName(), '', clearCookieValue(sessionCookieName()));
    return response;
  }

  const apiBase = (process.env.PLATFORM_API_INTERNAL_URL || 'http://localhost:3001').replace(/\/+$/, '');
  let target: URL;
  try {
    target = new URL('/api/v1/' + path.join('/'), apiBase);
  } catch {
    return NextResponse.json({ message: 'Platform API is not configured' }, { status: 503 });
  }
  target.search = new URL(request.url).search;

  const headers = new Headers({ Authorization: 'Bearer ' + session.accessToken, Accept: 'application/json' });
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  try {
    const init: RequestInit = { method, headers, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15000) };
    if (method !== 'GET' && method !== 'HEAD') init.body = await request.arrayBuffer();
    const upstream = await fetch(target, init);
    if (upstream.status === 401) {
      const sessionId = parseCookie(request, sessionCookieName());
      await destroyWebSession(sessionId).catch(() => undefined);
      const response = NextResponse.json({ message: 'Your identity session is no longer authorized. Sign in again.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
      response.cookies.set(sessionCookieName(), '', clearCookieValue(sessionCookieName()));
      return response;
    }
    const responseHeaders = new Headers({
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const upstreamContentType = upstream.headers.get('content-type');
    if (upstreamContentType) responseHeaders.set('Content-Type', upstreamContentType);
    const body = await upstream.arrayBuffer();
    return new NextResponse(body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return NextResponse.json({ message: 'Platform API request failed' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
