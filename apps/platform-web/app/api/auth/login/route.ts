import { randomNonce, randomPKCECodeVerifier, randomState, calculatePKCECodeChallenge, buildAuthorizationUrl } from 'openid-client';
import { NextResponse, type NextRequest } from 'next/server';
import {
  getOidcConfiguration, getOidcRedirectUri, getPlatformWebBaseUrl,
  oidcTransactionCookieName, storeOidcTransaction, transactionCookieOptions,
} from '../../../../lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
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

    const response = NextResponse.redirect(buildAuthorizationUrl(configuration, parameters), 302);
    response.cookies.set(oidcTransactionCookieName, state, transactionCookieOptions());
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  } catch {
    const response = NextResponse.redirect(new URL('/?auth_error=configuration', getPlatformWebBaseUrl()), 303);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  }
}
