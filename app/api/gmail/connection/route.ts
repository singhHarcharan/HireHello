import { getServerSession } from 'next-auth/next';
import { NextResponse } from 'next/server';
import { authOptions } from '../../auth/[...nextauth]/auth-options';
import { getDb } from '@/lib/db';
import type { GmailGrant } from '@/lib/gmail/grant';
import { decryptRefreshToken } from '@/lib/gmail/crypto';

export const runtime = 'nodejs';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = await getDb();
  const grant = await db.collection('google_grants').findOne({ userId: session.user.id }, { projection: { gmailAddress: 1, status: 1 } });
  return NextResponse.json({ connected: grant?.status === 'connected', email: grant?.gmailAddress, status: grant?.status ?? 'disconnected' });
}

export async function DELETE(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const db = await getDb();
  const grant = await db.collection<GmailGrant>('google_grants').findOne({ userId: session.user.id });
  // Stop future queue claims before revocation. In-flight sends may complete.
  await db.collection('campaigns').updateMany({ userId: session.user.id, status: 'queued' }, { $set: { status: 'paused', pauseReason: 'gmail_disconnected' } });
  await db.collection('google_grants').deleteOne({ userId: session.user.id });
  if (grant) {
    try {
      const token = decryptRefreshToken(grant.encryptedRefreshToken);
      await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
    } catch { /* Local credential has already been removed. */ }
  }
  return NextResponse.json({ connected: false });
}
