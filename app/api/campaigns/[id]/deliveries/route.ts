import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, jsonError, objectId, requireUserId } from '@/lib/core/http';
import { publicDelivery } from '@/lib/core/campaigns';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const userId = await requireUserId();
    const campaignId = objectId((await params).id);
    const db = await getDb();
    if (!await db.collection('campaigns').findOne({ _id: campaignId, userId })) throw new ApiError(404, 'NOT_FOUND', 'Campaign not found');
    const page = Math.max(1, Math.min(1000, Number(request.nextUrl.searchParams.get('page') || '1') || 1));
    const deliveries = await db.collection('deliveries').find({ userId, campaignId }).sort({ createdAt: 1 }).skip((page - 1) * 100).limit(100).toArray();
    return NextResponse.json({ deliveries: deliveries.map(publicDelivery), page });
  } catch (error) { return jsonError(error); }
}
