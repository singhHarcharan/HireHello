import { google } from 'googleapis';
import { getDb } from '@/lib/db';
import { decryptRefreshToken } from './crypto';

export interface GmailGrant {
  userId: string;
  gmailAddress: string;
  scopes: string[];
  encryptedRefreshToken: string;
  status: 'connected' | 'reconnect_required';
  updatedAt: Date;
}

export async function getConnectedGrant(userId: string): Promise<GmailGrant | null> {
  const db = await getDb();
  return db.collection<GmailGrant>('google_grants').findOne({ userId, status: 'connected' });
}

export async function gmailClientForGrant(grant: GmailGrant) {
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  client.setCredentials({ refresh_token: decryptRefreshToken(grant.encryptedRefreshToken) });
  return google.gmail({ version: 'v1', auth: client });
}

export async function markGrantReconnectRequired(userId: string) {
  const db = await getDb();
  await db.collection('google_grants').updateOne({ userId }, { $set: { status: 'reconnect_required', updatedAt: new Date() } });
  await db.collection('campaigns').updateMany({ userId, status: 'queued' }, { $set: { status: 'paused', pauseReason: 'gmail_reconnect_required' } });
}
