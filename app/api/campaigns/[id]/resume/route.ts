import { dispatchCampaign } from '@/lib/queue/dispatch';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, jsonError, objectId, requireSameOrigin, requireUserId } from '@/lib/core/http';

type Params = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Params) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const _id = objectId((await params).id);
    const db = await getDb();
    const campaign = await db.collection('campaigns').findOne({ _id, userId, status: 'paused' });
    if (!campaign) throw new ApiError(409, 'NOT_RESUMABLE', 'Campaign is not paused');
    const grant = await db.collection('google_grants').findOne({ userId, status: 'connected' });
    if (!grant || grant.gmailAddress?.toLowerCase() !== campaign.senderAddress?.toLowerCase()) throw new ApiError(409, 'GMAIL_NOT_CONNECTED', 'Reconnect the original Gmail account');
    if (!await db.collection('deliveries').countDocuments({ userId, campaignId: _id, status: 'queued' })) throw new ApiError(409, 'NOT_RESUMABLE', 'No queued messages remain');
    await db.collection('campaigns').updateOne({ _id, userId, status: 'paused' }, { $set: { status: 'queued', pauseReason: null, updatedAt: new Date() } });
    const queueDispatchStatus = await dispatchCampaign(_id, userId, db);
    return NextResponse.json({ resumed: true, queueDispatchStatus });
  } catch (error) { return jsonError(error); }
}
