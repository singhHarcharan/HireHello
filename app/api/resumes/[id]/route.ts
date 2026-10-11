import { NextRequest, NextResponse } from 'next/server';
import { getDb, getResumeBucket } from '@/lib/db';
import { ApiError, jsonError, objectId, requireSameOrigin, requireUserId } from '@/lib/core/http';

type Params = { params: Promise<{ id: string }> };
export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const _id = objectId((await params).id);
    const db = await getDb();
    const doc = await db.collection('resumes').findOne({ _id, userId });
    if (!doc) throw new ApiError(404, 'NOT_FOUND', 'Resume not found');
    await db.collection('resumes').deleteOne({ _id, userId });
    await (await getResumeBucket()).delete(doc.gridFsFileId);
    return NextResponse.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
