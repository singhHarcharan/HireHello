import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { ApiError, isDuplicate, jsonError, requireSameOrigin, requireUserId } from '@/lib/core/http';
import { parseContactCsv } from '@/lib/core/csv';

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const userId = await requireUserId();
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || file.size > 256_000) throw new ApiError(400, 'INVALID_CSV', 'Choose a CSV file under 256 KB');
    const csv = await file.text();
    const parsed = parseContactCsv(csv);
    const db = await getDb();
    const seen = new Set<string>();
    const result: { valid: number; duplicate: number; invalid: number; suppressed: number; errors: { row: number; message: string }[] } = { valid: 0, duplicate: 0, invalid: parsed.errors.length, suppressed: 0, errors: parsed.errors };
    for (const row of parsed.rows) {
      try {
        const { emailNormalized, recruiterName, companyName } = row;
        if (seen.has(emailNormalized)) { result.duplicate++; continue; }
        seen.add(emailNormalized);
        if (await db.collection('suppressions').findOne({ userId, emailNormalized })) { result.suppressed++; continue; }
        if (await db.collection('contacts').countDocuments({ userId }) >= 1000) throw new ApiError(429, 'LIMIT_REACHED', 'Contact limit reached');
        try {
          await db.collection('contacts').insertOne({ userId, emailNormalized, email: emailNormalized, recruiterName, companyName, status: 'active', createdAt: new Date(), updatedAt: new Date() });
          result.valid++;
        } catch (error) {
          if (isDuplicate(error)) result.duplicate++;
          else throw error;
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) throw error;
        result.invalid++;
        result.errors.push({ row: row.row, message: error instanceof Error ? error.message : 'Invalid row' });
      }
    }
    return NextResponse.json(result);
  } catch (error) { return jsonError(error); }
}
