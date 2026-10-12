import { handleCallback } from '@vercel/queue';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { processUserOnce } from '@/worker/processor';

export const runtime = 'nodejs';
export const maxDuration = 120;

class ContinueSending extends Error {
  constructor(public afterSeconds: number) { super('Continue queued work'); }
}
// vercel.json makes this consumer private: no public send endpoint or cron secret.
export const POST = handleCallback(async (message: { campaignId?: string }) => {
  if (typeof message?.campaignId !== 'string' || !/^[a-f0-9]{24}$/.test(message.campaignId)) return;
  const db = await getDb();
  const campaign = await db.collection('campaigns').findOne({ _id: new ObjectId(message.campaignId) });
  if (!campaign) return;
  const afterSeconds = await processUserOnce(campaign.userId, db);
  // Durable redelivery schedules the next unit; no sleep or fire-and-forget work.
  if (afterSeconds !== null) throw new ContinueSending(afterSeconds);
}, {
  visibilityTimeoutSeconds: 180,
  retry(error) {
    return { afterSeconds: error instanceof ContinueSending ? Math.min(86400, Math.max(1, error.afterSeconds)) : 60 };
  },
});
