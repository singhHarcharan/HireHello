import { createHash, randomBytes } from 'node:crypto';
import { getServerSession } from 'next-auth/next';
import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { authOptions } from '../../auth/[...nextauth]/auth-options';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const redirectUri = new URL('/api/gmail/callback', request.url).toString();
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send'],
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256' as import('google-auth-library').CodeChallengeMethod,
    login_hint: session.user.email,
  });
  const response = NextResponse.redirect(url);
  const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/api/gmail', maxAge: 600 };
  response.cookies.set('hh_gmail_state', state, cookieOptions);
  response.cookies.set('hh_gmail_pkce', verifier, cookieOptions);
  return response;
}
