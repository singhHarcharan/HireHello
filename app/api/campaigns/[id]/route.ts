import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, jsonError, objectId, requireUserId } from '@/lib/core/http';
import { publicCampaign, publicDelivery } from '@/lib/core/campaigns';

type Params = { params: Promise<{ id: string }> };
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const userId = await requireUserId();
    const campaignId = objectId((await params).id);
    const db = await getDb();
    const campaign = await db.collection('campaigns').findOne({ _id: campaignId, userId });
    if (!campaign) throw new ApiError(404, 'NOT_FOUND', 'Campaign not found');
    const deliveries = await db.collection('deliveries').find({ campaignId, userId }).sort({ createdAt: 1 }).limit(100).toArray();
    return NextResponse.json({ campaign: publicCampaign(campaign), deliveries: deliveries.map(publicDelivery) });
  } catch (error) { return jsonError(error); }
}
