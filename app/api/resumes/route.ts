import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { getDb, getResumeBucket } from '@/lib/db';
import { ApiError, jsonError, requireSameOrigin, requireUserId, stringField } from '@/lib/core/http';

export async function GET() {
  try {
    const userId = await requireUserId();
    const docs = await (await getDb()).collection('resumes').find({ userId }).sort({ createdAt: -1 }).toArray();
    return NextResponse.json({ resumes: docs.map(doc => {
      const publicDoc: Record<string, unknown> = { ...doc, id: doc._id.toHexString() };
      delete publicDoc._id;
      delete publicDoc.gridFsFileId;
      return publicDoc;
    }) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024 || file.type !== 'application/pdf') throw new ApiError(400, 'INVALID_PDF', 'Choose a PDF under 10 MB');
    const label = stringField(form.get('label'), 'label', 100);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new ApiError(400, 'INVALID_PDF', 'File is not a PDF');
    const db = await getDb();
    if (await db.collection('resumes').countDocuments({ userId }) >= 20) throw new ApiError(429, 'LIMIT_REACHED', 'Resume limit reached');
    const fileId = new ObjectId();
    const stream = (await getResumeBucket()).openUploadStreamWithId(fileId, `${fileId}.pdf`, { metadata: { mimeType: 'application/pdf', userId } });
    try {
      Readable.from(buffer).pipe(stream);
      await finished(stream);
      const doc = { userId, label, gridFsFileId: fileId, sha256: createHash('sha256').update(buffer).digest('hex'), size: buffer.length, mimeType: 'application/pdf', createdAt: new Date() };
      const result = await db.collection('resumes').insertOne(doc);
      return NextResponse.json({ resume: { id: result.insertedId.toHexString(), userId, label, size: doc.size, sha256: doc.sha256, createdAt: doc.createdAt } }, { status: 201 });
    } catch (error) {
      await (await getResumeBucket()).delete(fileId).catch(() => undefined);
      throw error;
    }
  } catch (error) { return jsonError(error); }
}
