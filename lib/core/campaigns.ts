import { RESERVED_DELIVERY_STATUSES, IN_FLIGHT_DELIVERY_STATUSES } from './contact-outreach';
import { formatEmailBody } from './email-body';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { ApiError, objectId, stringField } from './http';
import { MAX_CAMPAIGN_CONTACTS, renderTemplate } from './validation';

export type CampaignInput = { name: string; templateId: ObjectId; resumeId: ObjectId; contactIds: ObjectId[]; sendMode: 'first_contact' | 'resend' };

export function parseCampaignInput(body: Record<string, unknown>): CampaignInput {
  const name = stringField(body.name, 'name', 100);
  const templateId = objectId(String(body.templateId ?? ''));
  const resumeId = objectId(String(body.resumeId ?? ''));
  if (!Array.isArray(body.contactIds) || body.contactIds.length < 1 || body.contactIds.length > MAX_CAMPAIGN_CONTACTS) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Choose 1 to ${MAX_CAMPAIGN_CONTACTS} contacts`);
  }
  const contactIds = body.contactIds.map(value => objectId(String(value)));
  if (new Set(contactIds.map(id => id.toHexString())).size !== contactIds.length) throw new ApiError(400, 'DUPLICATE_CONTACT', 'Select each contact once');
  const sendMode = body.sendMode ?? 'first_contact';
  if (sendMode !== 'first_contact' && sendMode !== 'resend') throw new ApiError(400, 'VALIDATION_ERROR', 'Choose first contact or resend');
  return { name, templateId, resumeId, contactIds, sendMode };
}

export async function prepareCampaign(user: { id: string; name: string }, input: CampaignInput) {
  const db = await getDb();
  const [template, resume, grant, contacts] = await Promise.all([
    db.collection('templates').findOne({ _id: input.templateId, userId: user.id }),
    db.collection('resumes').findOne({ _id: input.resumeId, userId: user.id }),
    db.collection('google_grants').findOne({ userId: user.id, status: 'connected' }),
    db.collection('contacts').find({ _id: { $in: input.contactIds }, userId: user.id }).toArray(),
  ]);
  if (!template) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Template not found');
  if (!resume) throw new ApiError(404, 'RESUME_NOT_FOUND', 'Resume not found');
  if (!grant?.gmailAddress) throw new ApiError(409, 'GMAIL_NOT_CONNECTED', 'Connect Gmail before sending');
  if (contacts.length !== input.contactIds.length) throw new ApiError(400, 'CONTACT_NOT_FOUND', 'One or more contacts were not found');
  const suppressions = await db.collection('suppressions').find({ userId: user.id, emailNormalized: { $in: contacts.map(c => c.emailNormalized) } }).toArray();
  const suppressed = new Set(suppressions.map(s => s.emailNormalized));
  const previous = await db.collection('deliveries').find({ userId: user.id, to: { $in: contacts.map(c => c.emailNormalized) }, status: { $in: RESERVED_DELIVERY_STATUSES } }).sort({ _id: -1 }).project({ to: 1, status: 1, sentAt: 1 }).toArray();
  const pending = new Set(previous.filter(d => IN_FLIGHT_DELIVERY_STATUSES.includes(d.status)).map(d => d.to));
  const accepted = new Map<string, typeof previous[number]>();
  for (const delivery of previous) if (delivery.status === 'accepted' && !accepted.has(delivery.to)) accepted.set(delivery.to, delivery);
  const contactById = new Map(contacts.map(c => [c._id.toHexString(), c]));
  const previews: { contactId: string; to: string; subject: string; bodyText: string; bodyHtml: string; previousDeliveryId: string | null; lastContactedAt?: Date }[] = [];
  const skipped: { contactId: string; reason: string }[] = [];
  for (const contactId of input.contactIds) {
    const contact = contactById.get(contactId.toHexString())!;
    let reason = '';
    if (contact.status !== 'active' || suppressed.has(contact.emailNormalized)) reason = 'suppressed';
    else if (pending.has(contact.emailNormalized)) reason = 'scheduled_or_needs_review';
    else if (input.sendMode === 'resend' && !accepted.has(contact.emailNormalized)) reason = 'not_previously_contacted';
    else if (input.sendMode !== 'resend' && accepted.has(contact.emailNormalized)) reason = 'already_contacted_choose_resend';
    if (reason) { skipped.push({ contactId: contactId.toHexString(), reason }); continue; }
    const fields = { recruiterName: contact.recruiterName, companyName: contact.companyName, senderName: user.name };
    const bodyText = renderTemplate(template.bodyText, fields);
    const last = accepted.get(contact.emailNormalized);
    previews.push({ contactId: contactId.toHexString(), to: contact.emailNormalized, subject: renderTemplate(template.subject, fields), bodyText, bodyHtml: formatEmailBody(bodyText), previousDeliveryId: last?._id.toHexString() ?? null, ...(last?.sentAt ? { lastContactedAt: last.sentAt as Date } : {}) });
  }
  return { senderAddress: grant.gmailAddress as string, template, resume, previews, skipped };
}

export function publicCampaign(doc: Record<string, unknown>) {
  const publicDoc: Record<string, unknown> = { ...doc, id: (doc._id as ObjectId).toHexString() };
  delete publicDoc._id;
  delete publicDoc.resumeSnapshotFileId;
  delete publicDoc.requestHash;
  delete publicDoc.idempotencyKey;
  return publicDoc;
}

export function publicDelivery(doc: Record<string, unknown>) {
  const { _id, ...rest } = doc;
  return { id: (_id as ObjectId).toHexString(), ...rest };
}
