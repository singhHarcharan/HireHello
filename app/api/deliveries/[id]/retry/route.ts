import { dispatchCampaign } from '@/lib/queue/dispatch';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, isDuplicate, jsonError, objectId, requireSameOrigin, requireUserId } from '@/lib/core/http';

type Params = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Params) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const _id = objectId((await params).id);
    const db = await getDb();
    const delivery = await db.collection('deliveries').findOne({ _id, userId, status: 'failed' });
    if (!delivery) throw new ApiError(409, 'NOT_RETRYABLE', 'Only known failed sends can be retried');
    const campaign = await db.collection('campaigns').findOne({ _id: delivery.campaignId, userId });
    if (!campaign || campaign.status === 'paused') throw new ApiError(409, 'CAMPAIGN_PAUSED', 'Campaign is paused');
    if (await db.collection('suppressions').findOne({ userId, emailNormalized: delivery.to })) throw new ApiError(409, 'SUPPRESSED', 'Contact is suppressed');
    const grant = await db.collection('google_grants').findOne({ userId, status: 'connected' });
    if (!grant || grant.gmailAddress?.toLowerCase() !== campaign.senderAddress?.toLowerCase()) throw new ApiError(409, 'GMAIL_NOT_CONNECTED', 'Reconnect the original Gmail account');
    let result;
    try { result = await db.collection('deliveries').findOneAndUpdate({ _id, userId, status: 'failed' }, { $set: { status: 'queued', errorCode: null, leaseUntil: null, updatedAt: new Date() } }, { returnDocument: 'after' }); }
    catch (error) {
      if (isDuplicate(error)) throw new ApiError(409, 'RECIPIENT_ALREADY_SCHEDULED', 'Recipient already has another active or accepted message');
      throw error;
    }
    if (!result) throw new ApiError(409, 'NOT_RETRYABLE', 'Delivery changed');
    await db.collection('campaigns').updateOne({ _id: delivery.campaignId, userId }, { $inc: { 'totals.failed': -1, 'totals.queued': 1 }, $set: { status: 'queued', updatedAt: new Date() } });
    const queueDispatchStatus = await dispatchCampaign(delivery.campaignId, userId, db);
    return NextResponse.json({ queued: true, queueDispatchStatus });
  } catch (error) { return jsonError(error); }
}
