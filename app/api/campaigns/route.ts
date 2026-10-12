import { createPreviewToken, requireCurrentPreview } from '@/lib/core/preview-token';
import { dispatchCampaign } from '@/lib/queue/dispatch';
import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { getDb, getResumeBucket } from '@/lib/db';
import { ApiError, isDuplicate, jsonBody, jsonError, requireSameOrigin, requireUserContext, requireUserId } from '@/lib/core/http';
import { parseCampaignInput, prepareCampaign, publicCampaign, publicDelivery } from '@/lib/core/campaigns';

export async function GET() {
  try {
    const userId = await requireUserId();
    const docs = await (await getDb()).collection('campaigns').find({ userId }).sort({ createdAt: -1 }).limit(100).toArray();
    return NextResponse.json({ campaigns: docs.map(publicCampaign) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: NextRequest) {
  let committed = false;
  let campaignId: ObjectId | undefined;
  let snapshotId: ObjectId | undefined;
  try {
    requireSameOrigin(request);
    const user = await requireUserContext();
    const key = request.headers.get('Idempotency-Key')?.trim();
    if (!key || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
    const body = await jsonBody(request);
    const input = parseCampaignInput(body);
    const requestHash = createHash('sha256').update(JSON.stringify({ previewToken: body.previewToken, name: input.name, templateId: input.templateId.toHexString(), resumeId: input.resumeId.toHexString(), contactIds: input.contactIds.map(id => id.toHexString()) })).digest('hex');
    const db = await getDb();
    const existing = await db.collection('campaigns').findOne({ userId: user.id, idempotencyKey: key });
    if (existing) return await campaignResult(existing, requestHash);
    const prepared = await prepareCampaign(user, input);
    requireCurrentPreview(body.previewToken, createPreviewToken(user.id, input, prepared));
    if (!prepared.previews.length) throw new ApiError(400, 'NO_ELIGIBLE_CONTACTS', 'No eligible contacts remain');
    const recent = await db.collection('campaigns').countDocuments({ userId: user.id, createdAt: { $gte: new Date(Date.now() - 3600_000) } });
    if (recent >= 5) throw new ApiError(429, 'RATE_LIMITED', 'Campaign creation limit reached for this hour');
    const now = new Date();
    const campaign = {
      userId: user.id,
      name: input.name,
      idempotencyKey: key,
      requestHash,
      status: 'preparing',
      senderAddress: prepared.senderAddress,
      templateSnapshot: { name: prepared.template.name, subject: prepared.template.subject, bodyText: prepared.template.bodyText, version: prepared.template.version },
      resumeSnapshotFileId: null as ObjectId | null,
      resumeLabel: prepared.resume.label,
      previewSkipped: prepared.skipped.length,
      queueDispatchStatus: 'pending',
      totals: { queued: prepared.previews.length, accepted: 0, failed: 0, skipped: prepared.skipped.length, uncertain: 0 },
      createdAt: now,
      updatedAt: now,
    };
    let inserted;
    try { inserted = await db.collection('campaigns').insertOne(campaign); }
    catch (error) {
      if (isDuplicate(error)) {
        const winner = await db.collection('campaigns').findOne({ userId: user.id, idempotencyKey: key });
        if (winner) return await campaignResult(winner, requestHash);
      }
      throw error;
    }
    campaignId = inserted.insertedId;
    const sourceBucket = await getResumeBucket();
    const chunks: Buffer[] = [];
    for await (const chunk of sourceBucket.openDownloadStream(prepared.resume.gridFsFileId as ObjectId)) chunks.push(Buffer.from(chunk));
    const pdf = Buffer.concat(chunks);
    if (pdf.length !== prepared.resume.size || pdf.length > 10 * 1024 * 1024) throw new ApiError(409, 'RESUME_CHANGED', 'Resume changed during campaign creation');
    snapshotId = new ObjectId();
    const upload = sourceBucket.openUploadStreamWithId(snapshotId, `${campaignId.toHexString()}-snapshot.pdf`, { metadata: { userId: user.id, campaignId, mimeType: 'application/pdf' } });
    Readable.from(pdf).pipe(upload);
    await finished(upload);
    const deliveryDocs = prepared.previews.map(item => ({
      userId: user.id, campaignId, contactId: new ObjectId(item.contactId), to: item.to,
      renderedSubject: item.subject, renderedBody: item.bodyText,
      status: 'queued', attemptCount: 0, leaseUntil: null, gmailMessageId: null,
      errorCode: null, createdAt: now, updatedAt: now,
    }));
    await db.collection('deliveries').insertMany(deliveryDocs);
    await db.collection('campaigns').updateOne({ _id: campaignId, userId: user.id, status: 'preparing' }, { $set: { resumeSnapshotFileId: snapshotId, status: 'queued', updatedAt: new Date() } });
    committed = true;
    await dispatchCampaign(campaignId, user.id, db);
    const saved = await db.collection('campaigns').findOne({ _id: campaignId, userId: user.id });
    return NextResponse.json({ campaign: publicCampaign(saved!), deliveries: (await db.collection('deliveries').find({ campaignId, userId: user.id }).toArray()).map(publicDelivery) }, { status: 201 });
  } catch (error) {
    if (campaignId && !committed) {
      // A queued-state update may have committed even if its acknowledgement was
      // lost. Cleanup only after atomically deleting an actually preparing row.
      try {
        const db = await getDb();
        const removed = await db.collection('campaigns').deleteOne({ _id: campaignId, status: 'preparing' });
        if (removed.deletedCount) {
          await db.collection('deliveries').deleteMany({ campaignId, status: 'queued' });
          if (snapshotId) await (await getResumeBucket()).delete(snapshotId);
        }
      } catch { /* Preserve uncertain state for recovery rather than deleting approved work. */ }
    }
    return jsonError(isDuplicate(error) ? new ApiError(409, 'RECIPIENT_ALREADY_SCHEDULED', 'A recipient is already queued or has been contacted') : error);
  }
}

async function campaignResult(campaign: Record<string, unknown>, requestHash: string) {
  if (campaign.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used with different campaign details');
  if (campaign.status === 'preparing') throw new ApiError(409, 'CAMPAIGN_PREPARING', 'Campaign is still being prepared; retry shortly');
  if (campaign.status === 'queued') await dispatchCampaign(campaign._id as ObjectId, campaign.userId as string);
  const deliveries = await (await getDb()).collection('deliveries').find({ campaignId: campaign._id }).toArray();
  return NextResponse.json({ campaign: publicCampaign(campaign), deliveries: deliveries.map(publicDelivery) });
}
