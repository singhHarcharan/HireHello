import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getDb } from '@/lib/db';
import { encryptRefreshToken } from '@/lib/gmail/crypto';
import type { GmailGrant } from '@/lib/gmail/grant';
import { consumeGmailOAuthAttempt } from '@/lib/gmail/oauth-attempt';

export const runtime = 'nodejs';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

export async function GET(request: NextRequest) {
  const dashboard = new URL('/dashboard', request.url);
  const params = request.nextUrl.searchParams;
  const response = (result: string) => {
    dashboard.searchParams.set('gmail', result);
    return NextResponse.redirect(dashboard);
  };
  const attempt = await consumeGmailOAuthAttempt(params.get('state'));
  if (!attempt) return response('invalid_state');
  if (params.has('error')) return response('denied');
  const code = params.get('code');
  if (!code) return response('missing_code');
  try {
    const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, attempt.redirectUri);
    const { tokens } = await client.getToken({ code, codeVerifier: attempt.codeVerifier });
    if (!tokens.id_token || !tokens.refresh_token) return response('authorization_incomplete');
    const verified = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const identity = verified.getPayload();
    if (!identity?.sub || identity.sub !== attempt.userId || !identity.email || !identity.email_verified) return response('account_mismatch');
    const scopes = (tokens.scope ?? '').split(' ').filter(Boolean);
    if (!scopes.includes(SEND_SCOPE)) return response('missing_send_permission');
    const db = await getDb();
    await db.collection<GmailGrant>('google_grants').updateOne(
      { userId: attempt.userId },
      { $set: {
        userId: attempt.userId,
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
