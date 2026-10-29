import { NextResponse } from 'next/server';
import { getRedisClient, logWebSecurityEvent } from '../../../../lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const redis = await getRedisClient();
    const result = await redis.ping();
    if (result !== 'PONG') throw new Error('Unexpected session-store readiness response');

    return NextResponse.json(
      { status: 'ready', dependencies: { sessionStore: 'ok' } },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  } catch {
    // Health endpoints must never expose Redis addresses, credentials or driver messages.
    logWebSecurityEvent('health.readiness.failed', { reason: 'session_store_unavailable', status: 503 });
    return NextResponse.json(
      { status: 'not_ready', dependencies: { sessionStore: 'unavailable' } },
      { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
    );
  }
}
