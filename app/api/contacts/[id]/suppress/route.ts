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
    const contact = await db.collection('contacts').findOne({ _id, userId });
    if (!contact) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
    await db.collection('suppressions').updateOne({ userId, emailNormalized: contact.emailNormalized }, { $setOnInsert: { userId, emailNormalized: contact.emailNormalized, reason: 'opt_out', createdAt: new Date() } }, { upsert: true });
    await db.collection('contacts').updateOne({ _id, userId }, { $set: { status: 'suppressed', updatedAt: new Date() } });
    const pending = await db.collection('deliveries').find({ userId, to: contact.emailNormalized, status: 'queued' }).toArray();
    const affectedCampaignIds = new Set<string>();
    for (const delivery of pending) {
      const changed = await db.collection('deliveries').updateOne({ _id: delivery._id, userId, status: 'queued' }, { $set: { status: 'skipped', errorCode: 'SUPPRESSED', updatedAt: new Date() } });
      if (changed.modifiedCount) {
        affectedCampaignIds.add(delivery.campaignId.toHexString());
        await db.collection('campaigns').updateOne({ _id: delivery.campaignId, userId }, { $inc: { 'totals.queued': -1, 'totals.skipped': 1 } });
      }
    }
    for (const campaignId of affectedCampaignIds) {
      if (!await db.collection('deliveries').countDocuments({ campaignId: objectId(campaignId), status: { $in: ['queued', 'sending'] } })) {
        await db.collection('campaigns').updateOne({ _id: objectId(campaignId), userId, status: { $in: ['queued', 'paused'] } }, { $set: { status: 'completed', completedAt: new Date() } });
      }
    }
    return NextResponse.json({ suppressed: true });
  } catch (error) { return jsonError(error); }
}
