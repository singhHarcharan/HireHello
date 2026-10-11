import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, jsonBody, jsonError, objectId, requireSameOrigin, requireUserId, stringField } from '@/lib/core/http';
import { validateTemplate } from '@/lib/core/validation';

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const _id = objectId((await params).id);
    const db = await getDb();
    const existing = await db.collection('templates').findOne({ _id, userId });
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Template not found');
    const body = await jsonBody(request);
    const name = body.name === undefined ? existing.name : stringField(body.name, 'name', 80);
    const subject = body.subject === undefined ? existing.subject : stringField(body.subject, 'subject', 180);
    const bodyText = body.bodyText === undefined ? existing.bodyText : stringField(body.bodyText, 'bodyText', 12000);
    validateTemplate(subject, bodyText);
    const changes = { name, subject, bodyText, version: existing.version + 1, updatedAt: new Date() };
    await db.collection('templates').updateOne({ _id, userId }, { $set: changes });
    return NextResponse.json({ template: { id: _id.toHexString(), userId, ...changes } });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const result = await (await getDb()).collection('templates').deleteOne({ _id: objectId((await params).id), userId });
    if (!result.deletedCount) throw new ApiError(404, 'NOT_FOUND', 'Template not found');
    return NextResponse.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
