import type { Db } from 'mongodb';

// Keep display eligibility and the database's duplicate-send guard in agreement.
export const RESERVED_DELIVERY_STATUSES = ['queued', 'sending', 'accepted', 'uncertain'];
export type OutreachStatus = 'ready' | 'scheduled' | 'contacted' | 'needs_review' | 'blocked';
export type ContactOutreach = { outreachStatus: OutreachStatus; contactedAt?: Date; campaignId?: string };

export function contactOutreach(blocked: boolean, delivery?: { status: string; sentAt?: Date; campaignId?: { toString(): string } }): ContactOutreach {
  const outreachStatus: OutreachStatus = blocked ? 'blocked'
    : delivery?.status === 'accepted' ? 'contacted'
    : delivery?.status === 'uncertain' ? 'needs_review'
    : delivery?.status === 'queued' || delivery?.status === 'sending' ? 'scheduled' : 'ready';
  return {
    outreachStatus,
    ...(delivery?.status === 'accepted' && delivery.sentAt ? { contactedAt: delivery.sentAt } : {}),
    ...(delivery?.campaignId ? { campaignId: delivery.campaignId.toString() } : {}),
  };
}

// Delivery history is authoritative, including for deleted and reimported contacts.
// One batched, owner-scoped lookup uses the same partial unique index as enqueueing.
export async function getContactOutreach(db: Db, userId: string, contacts: { emailNormalized: string; status?: string }[]) {
  if (!contacts.length) return new Map<string, ContactOutreach>();
  const emails = contacts.map(contact => contact.emailNormalized);
  const [deliveries, suppressions] = await Promise.all([
    db.collection('deliveries').find({ userId, to: { $in: emails }, status: { $in: RESERVED_DELIVERY_STATUSES } })
      .project<{ to: string; status: string; sentAt?: Date; campaignId?: { toString(): string } }>({ to: 1, status: 1, sentAt: 1, campaignId: 1 }).toArray(),
    db.collection('suppressions').find({ userId, emailNormalized: { $in: emails } }).project({ emailNormalized: 1 }).toArray(),
  ]);
  const byEmail = new Map(deliveries.map(delivery => [delivery.to, delivery]));
  const blocked = new Set(suppressions.map(entry => entry.emailNormalized));
  return new Map(contacts.map(contact => [contact.emailNormalized, contactOutreach(contact.status === 'suppressed' || blocked.has(contact.emailNormalized), byEmail.get(contact.emailNormalized))]));
}
