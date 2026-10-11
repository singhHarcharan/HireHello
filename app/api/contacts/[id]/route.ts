import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, isDuplicate, jsonBody, jsonError, objectId, requireSameOrigin, requireUserId, stringField } from '@/lib/core/http';
import { normalizeEmail, noHeaderInjection } from '@/lib/core/validation';

type Params = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const _id = objectId((await params).id);
    const db = await getDb();
    const existing = await db.collection('contacts').findOne({ _id, userId });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
    const body = await jsonBody(request);
    const emailNormalized = body.email === undefined ? existing.emailNormalized : normalizeEmail(body.email);
    const recruiterName = body.recruiterName === undefined ? existing.recruiterName : stringField(body.recruiterName, 'recruiterName', 120);
    const companyName = body.companyName === undefined ? existing.companyName : stringField(body.companyName, 'companyName', 120);
    if (!noHeaderInjection(recruiterName) || !noHeaderInjection(companyName)) throw new ApiError(400, 'VALIDATION_ERROR', 'Names must be one line');
    if (await db.collection('suppressions').findOne({ userId, emailNormalized })) throw new ApiError(409, 'SUPPRESSED', 'This contact is suppressed');
    try {
      const result = await db.collection('contacts').findOneAndUpdate({ _id, userId }, { $set: { email: emailNormalized, emailNormalized, recruiterName, companyName, updatedAt: new Date() } }, { returnDocument: 'after' });
      if (!result) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
      const { _id: id, ...rest } = result;
      return NextResponse.json({ contact: { id: id.toHexString(), ...rest } });
    } catch (error) {
      if (isDuplicate(error)) throw new ApiError(409, 'DUPLICATE', 'Contact already exists');
      throw error;
    }
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const result = await (await getDb()).collection('contacts').deleteOne({ _id: objectId((await params).id), userId });
    if (!result.deletedCount) throw new ApiError(404, 'NOT_FOUND', 'Contact not found');
    return NextResponse.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
