import { timingSafeEqual } from 'node:crypto';
import { getServerSession } from 'next-auth/next';
import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { authOptions } from '../../auth/[...nextauth]/auth-options';
import { getDb } from '@/lib/db';
import { encryptRefreshToken } from '@/lib/gmail/crypto';
import type { GmailGrant } from '@/lib/gmail/grant';

export const runtime = 'nodejs';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: NextRequest) {
  const dashboard = new URL('/dashboard', request.url);
  const state = request.cookies.get('hh_gmail_state')?.value;
  const verifier = request.cookies.get('hh_gmail_pkce')?.value;
  const params = request.nextUrl.searchParams;
  const session = await getServerSession(authOptions);
  const response = (result: string) => {
    dashboard.searchParams.set('gmail', result);
    const redirect = NextResponse.redirect(dashboard);
    redirect.cookies.set('hh_gmail_state', '', { path: '/api/gmail', maxAge: 0 });
    redirect.cookies.set('hh_gmail_pkce', '', { path: '/api/gmail', maxAge: 0 });
    return redirect;
  };
  if (!session?.user?.id || !sameState(state, params.get('state')) || !verifier) return response('invalid_state');
  if (params.has('error')) return response('denied');
  const code = params.get('code');
  if (!code) return response('missing_code');
  try {
    const redirectUri = new URL('/api/gmail/callback', request.url).toString();
    const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
    const { tokens } = await client.getToken({ code, codeVerifier: verifier });
    if (!tokens.id_token || !tokens.refresh_token) return response('authorization_incomplete');
    const verified = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const identity = verified.getPayload();
    if (!identity?.sub || identity.sub !== session.user.id || !identity.email || !identity.email_verified) return response('account_mismatch');
    const scopes = (tokens.scope ?? '').split(' ').filter(Boolean);
    if (!scopes.includes(SEND_SCOPE)) return response('missing_send_permission');
    const db = await getDb();
    await db.collection<GmailGrant>('google_grants').updateOne(
      { userId: session.user.id },
      { $set: {
        userId: session.user.id,
        gmailAddress: identity.email,
        scopes,
        encryptedRefreshToken: encryptRefreshToken(tokens.refresh_token),
        status: 'connected',
        updatedAt: new Date(),
      } },
      { upsert: true },
    );
    return response('connected');
  } catch {
    // OAuth errors can contain credentials; do not log raw provider responses.
    return response('connection_failed');
  }
}
