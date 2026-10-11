import { getServerSession } from 'next-auth/next';
import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { authOptions } from '../../auth/[...nextauth]/auth-options';
import { createGmailOAuthAttempt } from '@/lib/gmail/oauth-attempt';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id || !session.user.email) return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
  const redirectUri = new URL('/api/gmail/callback', request.url).toString();
  const { state, codeChallenge } = await createGmailOAuthAttempt(session.user.id, redirectUri);
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri);
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: true,
    scope: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.send'],
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256' as import('google-auth-library').CodeChallengeMethod,
    login_hint: session.user.email,
  });
  return NextResponse.redirect(url);
}
