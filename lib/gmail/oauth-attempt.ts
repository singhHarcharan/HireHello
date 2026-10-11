import { createHash, randomBytes } from 'node:crypto';
import { getDb } from '@/lib/db';

const ATTEMPT_LIFETIME_MS = 10 * 60 * 1000;

type GmailOAuthAttempt = {
  _id: string;
  userId: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
};

function stateId(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export async function createGmailOAuthAttempt(userId: string, redirectUri: string) {
  const state = randomBytes(32).toString('base64url');
  const codeVerifier = randomBytes(48).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const db = await getDb();
  await db.collection<GmailOAuthAttempt>('gmail_oauth_attempts').insertOne({
    _id: stateId(state),
    userId,
    codeVerifier,
    redirectUri,
    expiresAt: new Date(Date.now() + ATTEMPT_LIFETIME_MS),
  });
  return { state, codeChallenge };
}

export async function consumeGmailOAuthAttempt(state: string | null) {
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) return null;
  const db = await getDb();
  // One callback owns the attempt. Expired and replayed callbacks cannot exchange a code.
  return db.collection<GmailOAuthAttempt>('gmail_oauth_attempts').findOneAndDelete({
    _id: stateId(state),
    expiresAt: { $gt: new Date() },
  });
}
