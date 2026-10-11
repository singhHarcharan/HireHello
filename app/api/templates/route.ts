import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, jsonBody, jsonError, requireSameOrigin, requireUserId, stringField } from '@/lib/core/http';
import { validateTemplate } from '@/lib/core/validation';

export async function GET() {
  try {
    const userId = await requireUserId();
    const docs = await (await getDb()).collection('templates').find({ userId }).sort({ updatedAt: -1 }).toArray();
    return NextResponse.json({ templates: docs.map(({ _id, ...rest }) => ({ id: _id.toHexString(), ...rest })) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const body = await jsonBody(request);
    const name = stringField(body.name, 'name', 80);
    const subject = stringField(body.subject, 'subject', 180);
    const bodyText = stringField(body.bodyText, 'bodyText', 12000);
    validateTemplate(subject, bodyText);
    const db = await getDb();
    if (await db.collection('templates').countDocuments({ userId }) >= 50) throw new ApiError(429, 'LIMIT_REACHED', 'Template limit reached');
    const now = new Date();
    const doc = { userId, name, subject, bodyText, version: 1, createdAt: now, updatedAt: now };
    const result = await db.collection('templates').insertOne(doc);
    return NextResponse.json({ template: { id: result.insertedId.toHexString(), ...doc } }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
