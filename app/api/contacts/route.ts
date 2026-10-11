import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getContactOutreach } from '@/lib/core/contact-outreach';
import { ApiError, isDuplicate, jsonBody, jsonError, requireSameOrigin, requireUserId, stringField } from '@/lib/core/http';
import { normalizeEmail, noHeaderInjection } from '@/lib/core/validation';

export async function GET() {
  try {
    const userId = await requireUserId();
    const db = await getDb();
    const contacts = await db.collection<{ emailNormalized: string; status?: string }>('contacts').find({ userId }).sort({ createdAt: -1 }).limit(1000).toArray();
    const outreach = await getContactOutreach(db, userId, contacts);
    return NextResponse.json({ contacts: contacts.map(({ _id, ...rest }) => ({ id: _id.toHexString(), ...rest, ...outreach.get(rest.emailNormalized) })) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const body = await jsonBody(request);
    const emailNormalized = normalizeEmail(body.email);
    const recruiterName = stringField(body.recruiterName, 'recruiterName', 120);
    const companyName = stringField(body.companyName, 'companyName', 120);
    if (!noHeaderInjection(recruiterName) || !noHeaderInjection(companyName)) throw new ApiError(400, 'VALIDATION_ERROR', 'Names must be one line');
    const db = await getDb();
    if (await db.collection('suppressions').findOne({ userId, emailNormalized })) throw new ApiError(409, 'SUPPRESSED', 'This contact is suppressed');
    if (await db.collection('contacts').countDocuments({ userId }) >= 1000) throw new ApiError(429, 'LIMIT_REACHED', 'Contact limit reached');
    const doc = { userId, emailNormalized, email: emailNormalized, recruiterName, companyName, status: 'active', createdAt: new Date(), updatedAt: new Date() };
    try {
      const result = await db.collection('contacts').insertOne(doc);
      return NextResponse.json({ contact: { id: result.insertedId.toHexString(), ...doc } }, { status: 201 });
    } catch (error) {
      if (isDuplicate(error)) throw new ApiError(409, 'DUPLICATE', 'Contact already exists');
      throw error;
    }
  } catch (error) { return jsonError(error); }
}
