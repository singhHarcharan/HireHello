import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, jsonError, objectId, requireSameOrigin, requireUserId } from '@/lib/core/http';
import { dispatchCampaign } from '@/lib/queue/dispatch';

type Params = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Params) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const _id = objectId((await params).id);
    const db = await getDb();
    const campaign = await db.collection('campaigns').findOne({ _id, userId, status: 'queued' });
    if (!campaign) throw new ApiError(409, 'NOT_QUEUED', 'Only a queued campaign can restart sending');
    // Avoid accidental rapid repeated publications; Mongo is the cross-instance guard.
    const updated = await db.collection('campaigns').updateOne({ _id, userId, $or: [
      { dispatchRequestedAt: { $exists: false } }, { dispatchRequestedAt: { $lt: new Date(Date.now() - 30_000) } },
    ] }, { $set: { dispatchRequestedAt: new Date() } });
    if (!updated.modifiedCount) throw new ApiError(429, 'RATE_LIMITED', 'Wait 30 seconds before restarting again');
    const queueDispatchStatus = await dispatchCampaign(_id, userId, db);
    return NextResponse.json({ queued: true, queueDispatchStatus, queueDispatchError: queueDispatchStatus === 'pending' ? 'queue_unavailable' : null }, { status: queueDispatchStatus === 'pending' ? 202 : 200 });
  } catch (error) { return jsonError(error); }
}
