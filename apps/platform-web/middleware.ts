import { NextRequest, NextResponse } from 'next/server';
import { buildContentSecurityPolicy } from './lib/csp';

export function middleware(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, '');
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce, process.env.NODE_ENV === 'production');
  const requestHeaders = new Headers(request.headers);

  // Next.js reads the forwarded CSP to apply this nonce to framework-generated scripts.
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', contentSecurityPolicy);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
    },
  ],
};
