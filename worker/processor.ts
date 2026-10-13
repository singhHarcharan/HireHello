import { randomUUID } from 'node:crypto';
import { Db, ObjectId } from 'mongodb';
import { getDb, getResumeBucket } from '../lib/db';
import { getConnectedGrant, markGrantReconnectRequired } from '../lib/gmail/grant';
import { decryptRefreshToken } from '../lib/gmail/crypto';
import { google } from 'googleapis';
import { buildRawMime, sendRawWithGmail } from '../lib/gmail/send';
import { classifyGmailFailure } from './outcome';

export interface Delivery {
  _id: ObjectId;
  campaignId: ObjectId;
  userId: string;
  to: string;
  renderedSubject: string;
  renderedBody: string;
  renderedHtml?: string;
  status: 'queued' | 'sending' | 'accepted' | 'failed' | 'skipped' | 'uncertain';
  attemptCount: number;
  nextAttemptAt?: Date;
  leaseUntil?: Date;
  leaseOwner?: string;
}
export interface Campaign {
  _id: ObjectId;
  userId: string;
  senderAddress: string;
  resumeSnapshotFileId: ObjectId;
  status: 'queued' | 'paused' | 'completed';
}
export const sendIntervalMs = Math.max(5000, Number(process.env.WORKER_SEND_INTERVAL_MS) || 15000);
export const dailyCap = Math.max(1, Number(process.env.WORKER_DAILY_CAP) || 20);

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

async function finish(db: Db, delivery: Delivery, status: 'accepted' | 'failed' | 'skipped' | 'uncertain', fields: Record<string, unknown> = {}) {
  const result = await db.collection<Delivery>('deliveries').updateOne(
    { _id: delivery._id, status: 'sending', leaseOwner: delivery.leaseOwner },
    { $set: { status, ...fields }, $unset: { leaseUntil: '', leaseOwner: '' } },
  );
  if (result.modifiedCount) await reconcileCampaign(db, delivery.campaignId);
}

async function requeue(db: Db, delivery: Delivery) {
  const backoffMs = Math.min(60 * 60 * 1000, 30_000 * 2 ** Math.max(0, delivery.attemptCount - 1));
  await db.collection<Delivery>('deliveries').updateOne(
    { _id: delivery._id, status: 'sending', leaseOwner: delivery.leaseOwner },
    { $set: { status: 'queued', nextAttemptAt: new Date(Date.now() + backoffMs) }, $unset: { leaseUntil: '', leaseOwner: '' } },
  );
}

async function processOne(db: Db, delivery: Delivery, deps: ProcessorDependencies) {
  const campaign = await db.collection<Campaign>('campaigns').findOne({ _id: delivery.campaignId, userId: delivery.userId });
  if (!campaign || campaign.status !== 'queued') {
    await db.collection('deliveries').updateOne({ _id: delivery._id, status: 'sending', leaseOwner: delivery.leaseOwner }, { $set: { status: 'queued' }, $unset: { leaseUntil: '', leaseOwner: '' } });
    return;
  }
  const grant = await deps.getGrant(delivery.userId);
  if (!grant || grant.gmailAddress.toLowerCase() !== campaign.senderAddress.toLowerCase()) {
    await db.collection('campaigns').updateOne({ _id: campaign._id }, { $set: { status: 'paused', pauseReason: 'gmail_reconnect_required' } });
    await finish(db, delivery, 'failed', { errorCode: 'gmail_reconnect_required' });
    return;
  }
  const normalized = delivery.to.trim().toLowerCase();
  if (await db.collection('suppressions').findOne({ userId: delivery.userId, emailNormalized: normalized })) {
    await finish(db, delivery, 'skipped', { errorCode: 'suppressed' });
    return;
  }
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sentToday = await db.collection('deliveries').countDocuments({ userId: delivery.userId, status: { $in: ['accepted', 'uncertain'] }, $or: [{ sentAt: { $gte: since } }, { claimedAt: { $gte: since } }] });
  if (sentToday >= deps.dailyCap) {
    await db.collection('campaigns').updateMany({ userId: delivery.userId, status: 'queued' }, { $set: { status: 'paused', pauseReason: 'daily_cap' } });
    await db.collection('deliveries').updateOne({ _id: delivery._id, status: 'sending', leaseOwner: delivery.leaseOwner }, { $set: { status: 'queued' }, $unset: { leaseUntil: '', leaseOwner: '' } });
    return;
  }
  let pdf: Buffer;
  try { pdf = await deps.readSnapshot(campaign.resumeSnapshotFileId); }
  catch { await finish(db, delivery, 'failed', { errorCode: 'resume_snapshot_unavailable' }); return; }
  let accessToken: string;
  try {
    accessToken = await deps.accessToken(grant);
  } catch {
    await deps.reconnect(delivery.userId);
    await finish(db, delivery, 'failed', { errorCode: 'gmail_reconnect_required' });
    return;
  }
  let raw: string;
  try {
    raw = await buildRawMime({ from: campaign.senderAddress, to: delivery.to, subject: delivery.renderedSubject, body: delivery.renderedBody, bodyHtml: delivery.renderedHtml ?? null, pdf });
  } catch {
    await finish(db, delivery, 'failed', { errorCode: 'invalid_message' });
    return;
  }
  // The lock outlives a bounded Vercel invocation. Check both fences again after
  // slow preparation so an expired/stolen invocation cannot begin a Gmail call.
  const fenced = await db.collection('sender_locks').updateOne(
    { userId: delivery.userId, owner: delivery.leaseOwner, leaseUntil: { $gt: new Date() } },
    { $set: { leaseUntil: new Date(Date.now() + LEASE_MS), nextSendAt: new Date(Date.now() + deps.sendIntervalMs) } },
  );
  if (!fenced.matchedCount) return;
  const stillOwned = await db.collection('deliveries').updateOne(
    { _id: delivery._id, status: 'sending', leaseOwner: delivery.leaseOwner, leaseUntil: { $gt: new Date() } },
    { $set: { leaseUntil: new Date(Date.now() + LEASE_MS), sendStartedAt: new Date() } },
  );
  if (!stillOwned.matchedCount) return;
  let response: Response;
  try {
    response = await deps.send(accessToken, raw);
  } catch {
    // Gmail may have accepted the request before the connection failed.
    await finish(db, delivery, 'uncertain', { errorCode: 'gmail_response_unknown' });
    return;
  }
  if (response.ok) {
    // A 2xx response is acceptance even if the response body cannot be parsed.
    let gmailMessageId: string | undefined;
    try { gmailMessageId = (await response.json() as { id?: string }).id; } catch { /* accepted */ }
    await finish(db, delivery, 'accepted', { gmailMessageId, sentAt: new Date() });
    return;
  }
  let reason: string | undefined;
  try {
    const error = await response.json() as { error?: { errors?: { reason?: string }[]; status?: string } };
    reason = error.error?.errors?.[0]?.reason ?? error.error?.status;
  } catch { /* HTTP status is enough to classify a failed send. */ }
  const action = classifyGmailFailure(response.status, reason, delivery.attemptCount);
  if (action === 'reconnect') {
    await deps.reconnect(delivery.userId);
    await finish(db, delivery, 'failed', { errorCode: 'gmail_reconnect_required' });
    return;
  }
  if (action === 'pause_limit') {
    await db.collection('campaigns').updateMany({ userId: delivery.userId, status: 'queued' }, { $set: { status: 'paused', pauseReason: 'gmail_sending_limit' } });
    await finish(db, delivery, 'failed', { errorCode: 'gmail_sending_limit' });
    return;
  }
  if (action === 'retry') {
    await requeue(db, delivery);
    return;
  }
  await finish(db, delivery, 'failed', { errorCode: `gmail_http_${response.status}` });
}

async function markExpiredLeasesUncertain(db: Db, userId: string) {
  const expired = await db.collection<Delivery>('deliveries').find({ userId, status: 'sending', leaseUntil: { $lt: new Date() } }).toArray();
  for (const delivery of expired) await finish(db, delivery, 'uncertain', { errorCode: 'worker_stopped_during_send' });
}


// Lease exceeds the route's 120-second lifetime and Gmail's 30-second timeout.
// Expired sends are never put back in the send queue automatically.
export const LEASE_MS = 180_000;
export interface ProcessorDependencies {
  getGrant: typeof getConnectedGrant;
  reconnect: typeof markGrantReconnectRequired;
  readSnapshot: typeof readSnapshot;
  accessToken: (grant: NonNullable<Awaited<ReturnType<typeof getConnectedGrant>>>) => Promise<string>;
  send: typeof sendRawWithGmail;
  dailyCap: number;
  sendIntervalMs: number;
}
const productionDependencies: ProcessorDependencies = {
  getGrant: getConnectedGrant,
  reconnect: markGrantReconnectRequired,
  readSnapshot,
  async accessToken(grant) {
    const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    client.setCredentials({ refresh_token: decryptRefreshToken(grant.encryptedRefreshToken) });
    // Bound refresh requests as well as the Gmail send request.
    client.transporter.defaults = { ...client.transporter.defaults, timeout: 20_000, retry: false };
    const result = await client.getAccessToken();
    if (!result.token) throw new Error('empty_access_token');
    return result.token;
  },
  send: sendRawWithGmail,
  dailyCap,
  sendIntervalMs,
};

async function reconcileCampaign(db: Db, campaignId: ObjectId) {
  const groups = await db.collection('deliveries').aggregate<{ _id: string; count: number }>([
    { $match: { campaignId } }, { $group: { _id: '$status', count: { $sum: 1 } } },
  ]).toArray();
  const counts = Object.fromEntries(groups.map(group => [group._id, group.count]));
  const queued = (counts.queued || 0) + (counts.sending || 0);
  const fields: Record<string, unknown> = { 'totals.queued': queued };
  for (const status of ['accepted', 'failed', 'uncertain']) fields[`totals.${status}`] = counts[status] || 0;
  // Preview skips have no delivery records; retain that original count separately.
  const campaign = await db.collection('campaigns').findOne({ _id: campaignId });
  if (!campaign) return;
  const previewSkipped = campaign.previewSkipped ?? Math.max(0, (campaign.totals?.skipped || 0) - (counts.skipped || 0));
  fields.previewSkipped = previewSkipped;
  fields['totals.skipped'] = previewSkipped + (counts.skipped || 0);
  await db.collection('campaigns').updateOne({ _id: campaignId }, { $set: fields });
  if (!queued) await db.collection('campaigns').updateOne({ _id: campaignId, status: 'queued' }, { $set: { status: 'completed', completedAt: new Date() } });
}

/** Processes at most one message. Returns the next wake delay, or null when idle. */
export async function processUserOnce(userId: string, db?: Db, overrides: Partial<ProcessorDependencies> = {}): Promise<number | null> {
  db ??= await getDb();
  const deps = { ...productionDependencies, dailyCap: Math.max(1, Number(process.env.WORKER_DAILY_CAP) || 20), sendIntervalMs: Math.max(5000, Number(process.env.WORKER_SEND_INTERVAL_MS) || 15000), ...overrides };
  const locks = db.collection('sender_locks');
  // A unique userId index makes initialization safe across cold starts.
  try { await locks.updateOne({ userId }, { $setOnInsert: { userId, leaseUntil: new Date(0), nextSendAt: new Date(0) } }, { upsert: true }); }
  catch (error) { if ((error as { code?: number }).code !== 11000) throw error; }
  const owner = randomUUID();
  const now = new Date();
  const lock = await locks.findOneAndUpdate(
    { userId, leaseUntil: { $lte: now } },
    { $set: { owner, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
    { returnDocument: 'after' },
  );
  if (!lock) return 30;
  try {
    await markExpiredLeasesUncertain(db, userId);
    const active = await db.collection<Campaign>('campaigns').find({ userId, status: 'queued' }).toArray();
    // Reconciliation repairs interrupted result/counter writes before future work.
    for (const campaign of active) await reconcileCampaign(db, campaign._id);
    if (!active.length) return null;
    const candidate = await db.collection<Delivery>('deliveries').findOne(
      { userId, campaignId: { $in: active.map(c => c._id) }, status: { $in: ['queued', 'sending'] } },
      { sort: { nextAttemptAt: 1, _id: 1 } },
    );
    if (!candidate) return null;
    const waitUntil = Math.max(lock.nextSendAt?.getTime() || 0, candidate.nextAttemptAt?.getTime() || 0,
      candidate.status === 'sending' ? candidate.leaseUntil?.getTime() || 0 : 0);
    if (waitUntil > Date.now()) return Math.max(1, Math.ceil((waitUntil - Date.now()) / 1000));
    const delivery = await db.collection<Delivery>('deliveries').findOneAndUpdate(
      { _id: candidate._id, status: 'queued' },
      { $set: { status: 'sending', leaseOwner: owner, leaseUntil: new Date(Date.now() + LEASE_MS), claimedAt: new Date() }, $inc: { attemptCount: 1 } },
      { returnDocument: 'after' },
    );
    if (!delivery) return 30;
    // Persist pacing before the call, so a crashed invocation still reserves a slot.
    await locks.updateOne({ userId, owner }, { $set: { nextSendAt: new Date(Date.now() + deps.sendIntervalMs) } });
    await processOne(db, delivery, deps);
    await locks.updateOne({ userId, owner }, { $set: { nextSendAt: new Date(Date.now() + deps.sendIntervalMs) } });
    return Math.ceil(deps.sendIntervalMs / 1000);
  } finally {
    await locks.updateOne({ userId, owner }, { $set: { leaseUntil: new Date(0) }, $unset: { owner: '' } });
  }
}
