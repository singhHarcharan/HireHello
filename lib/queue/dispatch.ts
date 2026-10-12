import { send } from '@vercel/queue';
import { Db, ObjectId } from 'mongodb';
import { getDb } from '../db';

export const SEND_TOPIC = 'hirehello-send';
export type DispatchStatus = 'published' | 'pending' | 'local';

/** Publication can fail after Mongo commits. Keep approved work, expose recovery. */
export async function dispatchCampaign(campaignId: ObjectId, userId: string,
  db?: Db, publish: typeof send = send, useQueue = process.env.VERCEL === '1',
): Promise<DispatchStatus> {
  db ??= await getDb();
  const campaign = await db.collection('campaigns').findOne({ _id: campaignId, userId, status: 'queued' });
  if (!campaign) return 'pending';
  let queueDispatchStatus: DispatchStatus = useQueue ? 'pending' : 'local';
  if (useQueue) {
    try {
      // IDs only: no addresses, message bodies, PDFs, or OAuth tokens in the queue.
      await publish(SEND_TOPIC, { campaignId: campaignId.toHexString() }, { retentionSeconds: 604800 });
      queueDispatchStatus = 'published';
    } catch {
      console.error('Campaign saved; queue publication unavailable');
    }
  }
  try { await db.collection('campaigns').updateOne({ _id: campaignId, userId }, {
    $set: { queueDispatchStatus, queueDispatchError: queueDispatchStatus === 'pending' ? 'queue_unavailable' : null, queueDispatchedAt: new Date() },
  }); } catch {
    // Publication may already be live; telemetry failure must not undo work.
    console.error('Queue dispatch status could not be recorded');
  }
  return queueDispatchStatus;
}
