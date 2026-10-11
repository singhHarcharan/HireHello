import { loadEnvConfig } from '@next/env';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { getDb, getResumeBucket } from '../lib/db';
import { getConnectedGrant, markGrantReconnectRequired } from '../lib/gmail/grant';
import { decryptRefreshToken } from '../lib/gmail/crypto';
import { google } from 'googleapis';
import { buildRawMime, sendRawWithGmail } from '../lib/gmail/send';
import { classifyGmailFailure } from './outcome';

loadEnvConfig(process.cwd());

interface Delivery {
  _id: ObjectId;
  campaignId: ObjectId;
  userId: string;
  to: string;
  renderedSubject: string;
  renderedBody: string;
  status: 'queued' | 'sending' | 'accepted' | 'failed' | 'skipped' | 'uncertain';
  attemptCount: number;
  nextAttemptAt?: Date;
  leaseUntil?: Date;
  leaseOwner?: string;
}
interface Campaign {
  _id: ObjectId;
  userId: string;
  senderAddress: string;
  resumeSnapshotFileId: ObjectId;
  status: 'queued' | 'paused' | 'completed';
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const pollMs = Math.max(1000, Number(process.env.WORKER_POLL_MS) || 3000);
const sendIntervalMs = Math.max(5000, Number(process.env.WORKER_SEND_INTERVAL_MS) || 15000);
const dailyCap = Math.max(1, Number(process.env.WORKER_DAILY_CAP) || 20);

async function readSnapshot(id: ObjectId): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of (await getResumeBucket()).openDownloadStream(id)) {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) throw new Error('resume_snapshot_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function finish(delivery: Delivery, status: 'accepted' | 'failed' | 'skipped' | 'uncertain', fields: Record<string, unknown> = {}) {
  const db = await getDb();
  const result = await db.collection<Delivery>('deliveries').updateOne(
    { _id: delivery._id, status: 'sending', leaseOwner: delivery.leaseOwner },
    { $set: { status, ...fields }, $unset: { leaseUntil: '', leaseOwner: '' } },
  );
  if (result.modifiedCount) {
    await db.collection('campaigns').updateOne({ _id: delivery.campaignId }, { $inc: { 'totals.queued': -1, [`totals.${status}`]: 1 } });
    const remaining = await db.collection<Delivery>('deliveries').countDocuments({ campaignId: delivery.campaignId, status: { $in: ['queued', 'sending'] } });
    if (remaining === 0) await db.collection('campaigns').updateOne({ _id: delivery.campaignId, status: 'queued' }, { $set: { status: 'completed', completedAt: new Date() } });
  }
}

async function requeue(delivery: Delivery) {
  const db = await getDb();
  const backoffMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, delivery.attemptCount - 1));
  await db.collection<Delivery>('deliveries').updateOne(
    { _id: delivery._id, status: 'sending', leaseOwner: delivery.leaseOwner },
    { $set: { status: 'queued', nextAttemptAt: new Date(Date.now() + backoffMs) }, $unset: { leaseUntil: '', leaseOwner: '' } },
  );
}

async function claim(): Promise<Delivery | null> {
  const db = await getDb();
  const active = await db.collection<Campaign>('campaigns').find({ status: 'queued' }, { projection: { _id: 1 } }).toArray();
  if (!active.length) return null;
  const now = new Date();
  const leaseOwner = randomUUID();
  const claimed = await db.collection<Delivery>('deliveries').findOneAndUpdate(
    { campaignId: { $in: active.map(c => c._id) }, status: 'queued', $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: { $lte: now } }] },
    { $set: { status: 'sending', leaseUntil: new Date(now.getTime() + 120_000), leaseOwner, claimedAt: now }, $inc: { attemptCount: 1 } },
    { sort: { _id: 1 }, returnDocument: 'after' },
  );
  return claimed;
}

async function processOne(delivery: Delivery) {
  const db = await getDb();
  const campaign = await db.collection<Campaign>('campaigns').findOne({ _id: delivery.campaignId, userId: delivery.userId });
  if (!campaign || campaign.status !== 'queued') {
    await db.collection('deliveries').updateOne({ _id: delivery._id, status: 'sending', leaseOwner: delivery.leaseOwner }, { $set: { status: 'queued' }, $unset: { leaseUntil: '', leaseOwner: '' } });
    return;
  }
  const grant = await getConnectedGrant(delivery.userId);
  if (!grant || grant.gmailAddress.toLowerCase() !== campaign.senderAddress.toLowerCase()) {
    await db.collection('campaigns').updateOne({ _id: campaign._id }, { $set: { status: 'paused', pauseReason: 'gmail_reconnect_required' } });
    await finish(delivery, 'failed', { errorCode: 'gmail_reconnect_required' });
    return;
  }
  const normalized = delivery.to.trim().toLowerCase();
  if (await db.collection('suppressions').findOne({ userId: delivery.userId, emailNormalized: normalized })) {
    await finish(delivery, 'skipped', { errorCode: 'suppressed' });
    return;
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sentToday = await db.collection('deliveries').countDocuments({ userId: delivery.userId, status: 'accepted', sentAt: { $gte: since } });
  if (sentToday >= dailyCap) {
    await db.collection('campaigns').updateMany({ userId: delivery.userId, status: 'queued' }, { $set: { status: 'paused', pauseReason: 'daily_cap' } });
    await db.collection('deliveries').updateOne({ _id: delivery._id, status: 'sending', leaseOwner: delivery.leaseOwner }, { $set: { status: 'queued' }, $unset: { leaseUntil: '', leaseOwner: '' } });
    return;
  }
  let pdf: Buffer;
  try { pdf = await readSnapshot(campaign.resumeSnapshotFileId); }
  catch { await finish(delivery, 'failed', { errorCode: 'resume_snapshot_unavailable' }); return; }
  let accessToken: string;
  try {
    const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    client.setCredentials({ refresh_token: decryptRefreshToken(grant.encryptedRefreshToken) });
    const result = await client.getAccessToken();
    if (!result.token) throw new Error('empty_access_token');
    accessToken = result.token;
  } catch {
    await markGrantReconnectRequired(delivery.userId);
    await finish(delivery, 'failed', { errorCode: 'gmail_reconnect_required' });
    return;
  }
  let raw: string;
  try {
    raw = await buildRawMime({ from: campaign.senderAddress, to: delivery.to, subject: delivery.renderedSubject, body: delivery.renderedBody, pdf });
  } catch {
    await finish(delivery, 'failed', { errorCode: 'invalid_message' });
    return;
  }
  let response: Response;
  try {
    response = await sendRawWithGmail(accessToken, raw);
  } catch {
    // Gmail may have accepted the request before the connection failed.
    await finish(delivery, 'uncertain', { errorCode: 'gmail_response_unknown' });
    return;
  }
  if (response.ok) {
    const result = await response.json() as { id?: string };
    await finish(delivery, 'accepted', { gmailMessageId: result.id, sentAt: new Date() });
    return;
  }
  let reason: string | undefined;
  try {
    const error = await response.json() as { error?: { errors?: { reason?: string }[]; status?: string } };
    reason = error.error?.errors?.[0]?.reason ?? error.error?.status;
  } catch { /* HTTP status is enough to classify a failed send. */ }
  const action = classifyGmailFailure(response.status, reason, delivery.attemptCount);
  if (action === 'reconnect') {
    await markGrantReconnectRequired(delivery.userId);
    await finish(delivery, 'failed', { errorCode: 'gmail_reconnect_required' });
    return;
  }
  if (action === 'pause_limit') {
    await db.collection('campaigns').updateMany({ userId: delivery.userId, status: 'queued' }, { $set: { status: 'paused', pauseReason: 'gmail_sending_limit' } });
    await finish(delivery, 'failed', { errorCode: 'gmail_sending_limit' });
    return;
  }
  if (action === 'retry') {
    await requeue(delivery);
    return;
  }
  await finish(delivery, 'failed', { errorCode: `gmail_http_${response.status}` });
}

async function markExpiredLeasesUncertain() {
  const db = await getDb();
  const expired = await db.collection<Delivery>('deliveries').find({ status: 'sending', leaseUntil: { $lt: new Date() } }).toArray();
  for (const delivery of expired) await finish(delivery, 'uncertain', { errorCode: 'worker_stopped_during_send' });
}

async function run() {
  while (true) {
    try {
      await markExpiredLeasesUncertain();
      const delivery = await claim();
      if (delivery) {
        await processOne(delivery);
        await sleep(sendIntervalMs);
      } else await sleep(pollMs);
    } catch (error) {
      console.error('Worker iteration failed:', error instanceof Error ? error.name : 'unknown error');
      await sleep(pollMs);
    }
  }
}

run().catch(error => { console.error('Worker failed to start:', error instanceof Error ? error.name : 'unknown error'); process.exit(1); });
