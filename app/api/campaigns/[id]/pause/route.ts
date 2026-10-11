import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, jsonError, objectId, requireSameOrigin, requireUserId } from '@/lib/core/http';

type Params = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, { params }: Params) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const _id = objectId((await params).id);
    const result = await (await getDb()).collection('campaigns').findOneAndUpdate({ _id, userId, status: { $in: ['queued', 'sending'] } }, { $set: { status: 'paused', updatedAt: new Date() } }, { returnDocument: 'after' });
    if (!result) throw new ApiError(409, 'NOT_PAUSABLE', 'Campaign is not active');
    return NextResponse.json({ paused: true });
  } catch (error) { return jsonError(error); }
}
