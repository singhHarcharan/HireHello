import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { google } from 'googleapis';
import { createHash } from 'crypto';
import { createPreviewToken, requireCurrentPreview } from '@/lib/core/preview-token';
import { parseCampaignInput, prepareCampaign } from '@/lib/core/campaigns';
import { getDb, getResumeBucket } from '@/lib/db';
import { ApiError, isDuplicate, jsonBody, jsonError, requireSameOrigin, requireUserContext } from '@/lib/core/http';
import { getConnectedGrant, markGrantReconnectRequired } from '@/lib/gmail/grant';
import { decryptRefreshToken } from '@/lib/gmail/crypto';
import { buildRawMime, sendRawWithGmail } from '@/lib/gmail/send';

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    const user = await requireUserContext();
    const idempotencyKey = request.headers.get('Idempotency-Key')?.trim();
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a unique Idempotency-Key header');
    const body = await jsonBody(request);
    const input = parseCampaignInput(body);
    const requestHash = createHash('sha256').update(JSON.stringify({ input, previewToken: body.previewToken })).digest('hex');
    const db = await getDb();
    const prior = await db.collection('test_sends').findOne({ userId: user.id, idempotencyKey });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used for a different test');
      return priorResult(prior.status, prior.gmailMessageId);
    }
    const prepared = await prepareCampaign(user, input);
    requireCurrentPreview(body.previewToken, createPreviewToken(user.id, input, prepared));
    const first = prepared.previews[0];
    if (!first) throw new ApiError(400, 'NO_ELIGIBLE_CONTACTS', 'No eligible contacts remain');
    const { resume } = prepared;
    const grant = await getConnectedGrant(user.id);
    if (!grant?.gmailAddress) throw new ApiError(409, 'GMAIL_NOT_CONNECTED', 'Connect Gmail first');
    const pdfChunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of (await getResumeBucket()).openDownloadStream(resume.gridFsFileId as ObjectId)) {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) throw new ApiError(409, 'RESUME_CHANGED', 'Resume is too large');
      pdfChunks.push(Buffer.from(chunk));
    }
    if (size !== resume.size) throw new ApiError(409, 'RESUME_CHANGED', 'Resume changed');
    const pdf = Buffer.concat(pdfChunks);
    const raw = await buildRawMime({ from: grant.gmailAddress, to: grant.gmailAddress, subject: first.subject, body: first.bodyText, bodyHtml: first.bodyHtml, pdf });
    if (await db.collection('test_sends').countDocuments({ userId: user.id, createdAt: { $gte: new Date(Date.now() - 24 * 3600_000) } }) >= 3) throw new ApiError(429, 'RATE_LIMITED', 'Limit of three test sends per 24 hours reached');
    try { await db.collection('test_sends').insertOne({ userId: user.id, idempotencyKey, requestHash, status: 'sending', to: grant.gmailAddress, createdAt: new Date() }); }
    catch (error) {
      if (isDuplicate(error)) {
        const winner = await db.collection('test_sends').findOne({ userId: user.id, idempotencyKey });
        if (winner) {
          if (winner.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This key was used for a different test');
          return priorResult(winner.status, winner.gmailMessageId);
        }
      }
      throw error;
    }
    let accessToken: string;
    try {
      const client = new google.auth.OAuth2({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, transporterOptions: { timeout: 20_000 } });
      client.setCredentials({ refresh_token: decryptRefreshToken(grant.encryptedRefreshToken) });
      const token = await client.getAccessToken();
      if (!token.token) throw new Error('Missing access token');
      accessToken = token.token;
    } catch {
      await markGrantReconnectRequired(user.id);
      await db.collection('test_sends').updateOne({ userId: user.id, idempotencyKey }, { $set: { status: 'failed', errorCode: 'gmail_reconnect_required' } });
      throw new ApiError(409, 'GMAIL_NOT_CONNECTED', 'Reconnect Gmail');
    }
    let response: Response;
    try { response = await sendRawWithGmail(accessToken, raw); }
    catch {
      await db.collection('test_sends').updateOne({ userId: user.id, idempotencyKey }, { $set: { status: 'uncertain', errorCode: 'gmail_response_unknown' } });
      throw new ApiError(409, 'SEND_UNCERTAIN', 'Gmail response was lost; check Sent Mail before trying again');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) await markGrantReconnectRequired(user.id);
      await db.collection('test_sends').updateOne({ userId: user.id, idempotencyKey }, { $set: { status: 'failed', errorCode: `gmail_http_${response.status}` } });
      throw new ApiError(502, 'GMAIL_REJECTED', `Gmail rejected the test message (${response.status})`);
    }
    // Gmail already accepted the message even if its response body is malformed.
    const gmailResult = await response.json().catch(() => ({})) as { id?: string };
    await db.collection('test_sends').updateOne({ userId: user.id, idempotencyKey }, { $set: { status: 'accepted', gmailMessageId: gmailResult.id, sentAt: new Date() } });
    return NextResponse.json({ status: 'accepted', gmailMessageId: gmailResult.id });
  } catch (error) { return jsonError(error); }
}

function priorResult(status: unknown, gmailMessageId: unknown) {
  if (status === 'accepted') return NextResponse.json({ status, gmailMessageId });
  if (status === 'failed') throw new ApiError(409, 'TEST_FAILED', 'Previous test send failed; use a new key to retry');
  if (status === 'uncertain' || status === 'sending') throw new ApiError(409, 'SEND_UNCERTAIN', 'This test may already have sent; check Sent Mail before trying again');
  throw new ApiError(409, 'TEST_IN_PROGRESS', 'Test send is in progress');
}
