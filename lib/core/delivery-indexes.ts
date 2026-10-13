import type { Db } from 'mongodb';
import { RESERVED_DELIVERY_STATUSES, IN_FLIGHT_DELIVERY_STATUSES } from './contact-outreach';

/** Install replacement guards before removing the original lifetime-send index. */
export async function ensureDeliveryIndexes(db: Db): Promise<void> {
  const deliveries = db.collection('deliveries');
  await deliveries.createIndex({ userId: 1, to: 1, previousDeliveryId: 1 }, {
    name: 'recipient_send_generation', unique: true,
    partialFilterExpression: { status: { $in: RESERVED_DELIVERY_STATUSES } },
  });
  await deliveries.createIndex({ userId: 1, to: 1 }, {
    name: 'recipient_in_flight', unique: true,
    partialFilterExpression: { status: { $in: IN_FLIGHT_DELIVERY_STATUSES } },
  });
  // Legacy rows have no previousDeliveryId: Mongo indexes missing and null alike.
  // Concurrent cold starts can both observe the old index; only one drops it.
  if ((await deliveries.listIndexes().toArray()).some(index => index.name === 'userId_1_to_1')) {
    try { await deliveries.dropIndex('userId_1_to_1'); }
    catch (error) { if ((error as { code?: number }).code !== 27) throw error; }
  }
  await deliveries.createIndex({ userId: 1, to: 1, sentAt: -1, _id: -1 });
}
