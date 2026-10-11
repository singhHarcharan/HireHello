import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { google } from 'googleapis';
import { getDb, getResumeBucket } from '@/lib/db';
import { ApiError, isDuplicate, jsonBody, jsonError, objectId, requireSameOrigin, requireUserContext, stringField } from '@/lib/core/http';
import { renderTemplate, validateTemplate, noHeaderInjection } from '@/lib/core/validation';
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
    const templateId = objectId(String(body.templateId ?? ''));
    const resumeId = objectId(String(body.resumeId ?? ''));
    const recruiterName = body.recruiterName === undefined ? user.name : stringField(body.recruiterName, 'recruiterName', 120);
    const companyName = body.companyName === undefined ? 'Example Company' : stringField(body.companyName, 'companyName', 120);
    if (!noHeaderInjection(recruiterName) || !noHeaderInjection(companyName)) throw new ApiError(400, 'VALIDATION_ERROR', 'Names must be one line');
    const db = await getDb();
    const prior = await db.collection('test_sends').findOne({ userId: user.id, idempotencyKey });
    if (prior) return priorResult(prior.status, prior.gmailMessageId);
    const [template, resume, grant] = await Promise.all([
      db.collection('templates').findOne({ _id: templateId, userId: user.id }),
      db.collection('resumes').findOne({ _id: resumeId, userId: user.id }),
      getConnectedGrant(user.id),
    ]);
    if (!template) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
    if (!resume) throw new ApiError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    if (!grant?.gmailAddress) throw new ApiError(409, 'GMAIL_NOT_CONNECTED', 'Connect Gmail first');
    validateTemplate(template.subject, template.bodyText);
    const fields = { recruiterName, companyName, senderName: user.name };
    const subject = renderTemplate(template.subject, fields);
    const messageBody = renderTemplate(template.bodyText, fields);
    const pdfChunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of (await getResumeBucket()).openDownloadStream(resume.gridFsFileId as ObjectId)) {
      size += chunk.length;
      if (size > 10 * 1024 * 1024) throw new ApiError(409, 'RESUME_CHANGED', 'Resume is too large');
      pdfChunks.push(Buffer.from(chunk));
    }
    if (size !== resume.size) throw new ApiError(409, 'RESUME_CHANGED', 'Resume changed');
    const pdf = Buffer.concat(pdfChunks);
    const raw = await buildRawMime({ from: grant.gmailAddress, to: grant.gmailAddress, subject, body: messageBody, pdf });
    if (await db.collection('test_sends').countDocuments({ userId: user.id, createdAt: { $gte: new Date(Date.now() - 24 * 3600_000) } }) >= 3) throw new ApiError(429, 'RATE_LIMITED', 'Limit of three test sends per 24 hours reached');
    try { await db.collection('test_sends').insertOne({ userId: user.id, idempotencyKey, status: 'sending', to: grant.gmailAddress, createdAt: new Date() }); }
    catch (error) {
      if (isDuplicate(error)) {
        const winner = await db.collection('test_sends').findOne({ userId: user.id, idempotencyKey });
        if (winner) return priorResult(winner.status, winner.gmailMessageId);
      }
      throw error;
    }
    let accessToken: string;
    try {
      const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
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
    const gmailResult = await response.json() as { id?: string };
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
