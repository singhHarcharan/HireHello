import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient, ObjectId, Db } from 'mongodb';
import { processUserOnce, ProcessorDependencies } from './processor';
import { dispatchCampaign } from '../lib/queue/dispatch';

// Never connects to the application DB. Each run owns a fresh disposable DB.
test('Mongo processor serializes callbacks, preserves pacing, handles crashes and retries safely', { skip: !process.env.MONGODB_TEST_URI }, async () => {
  const client = await new MongoClient(process.env.MONGODB_TEST_URI!).connect();
  const db = client.db(`hirehello_test_queue_${new ObjectId().toHexString()}`);
  let sends = 0;
  const deps: Partial<ProcessorDependencies> = {
    getGrant: async userId => ({ userId, gmailAddress: 'sender@example.com', encryptedRefreshToken: 'fake', scopes: [], status: 'connected', updatedAt: new Date() }),
    reconnect: async () => {},
    readSnapshot: async () => Buffer.from('%PDF-fake'),
    accessToken: async () => 'fake-token',
    send: async () => { sends++; return Response.json({ id: `fake-${sends}` }); },
  };
  const unlockPacing = (userId: string) => db.collection('sender_locks').updateOne({ userId }, { $set: { nextSendAt: new Date(0) } });
  try {
    await db.collection('sender_locks').createIndex({ userId: 1 }, { unique: true });
    const campaign = await seed(db, 'parallel', 2);
    await Promise.all(Array.from({ length: 8 }, () => processUserOnce('parallel', db, deps)));
    assert.equal(sends, 1, 'concurrent callbacks make only one send');
    assert.equal(await db.collection('deliveries').countDocuments({ userId: 'parallel', status: 'accepted' }), 1);
    await processUserOnce('parallel', db, deps);
    assert.equal(sends, 1, 'pacing survives callback boundary');
    await unlockPacing('parallel');
    await processUserOnce('parallel', db, deps);
    assert.equal(sends, 2);
    await Promise.all([processUserOnce('parallel', db, deps), processUserOnce('parallel', db, deps)]);
    assert.equal(sends, 2, 'redelivery after completion does not resend');
    assert.equal((await db.collection('campaigns').findOne({ _id: campaign }))?.totals.accepted, 2);

    const crashed = await seed(db, 'crashed', 1);
    await db.collection('deliveries').updateOne({ campaignId: crashed }, { $set: { status: 'sending', leaseOwner: 'dead', leaseUntil: new Date(0) } });
    await processUserOnce('crashed', db, deps);
    assert.equal(sends, 2, 'expired send is not retried');
    assert.equal((await db.collection('deliveries').findOne({ campaignId: crashed }))?.status, 'uncertain');
    assert.equal((await db.collection('campaigns').findOne({ _id: crashed }))?.status, 'completed');

    const timeout = await seed(db, 'timeout', 1);
    await processUserOnce('timeout', db, { ...deps, send: async () => { throw new Error('timeout'); } });
    assert.equal((await db.collection('deliveries').findOne({ campaignId: timeout }))?.status, 'uncertain');
    await processUserOnce('timeout', db, deps);
    assert.equal(sends, 2);

    const capped = await seed(db, 'capped', 2);
    await processUserOnce('capped', db, { ...deps, dailyCap: 1 });
    await unlockPacing('capped');
    await processUserOnce('capped', db, { ...deps, dailyCap: 1 });
    assert.equal(sends, 3);
    assert.equal((await db.collection('campaigns').findOne({ _id: capped }))?.pauseReason, 'daily_cap');
    assert.equal(await db.collection('deliveries').countDocuments({ campaignId: capped, status: 'queued' }), 1);

    const retry = await seed(db, 'retry', 1);
    await processUserOnce('retry', db, { ...deps, send: async () => new Response('', { status: 429 }) });
    let delivery = await db.collection('deliveries').findOne({ campaignId: retry });
    assert.equal(delivery?.status, 'queued');
    assert.ok(delivery?.nextAttemptAt > new Date());
    await unlockPacing('retry');
    await processUserOnce('retry', db, deps);
    assert.equal(sends, 3, 'Gmail backoff is enforced across callbacks');
    await db.collection('deliveries').updateOne({ campaignId: retry }, { $set: { nextAttemptAt: new Date(0) } });
    await processUserOnce('retry', db, deps);
    delivery = await db.collection('deliveries').findOne({ campaignId: retry });
    assert.equal(delivery?.status, 'accepted');
    assert.equal(delivery?.attemptCount, 2);

    // A known Gmail success with an unreadable body must never be retried.
    const malformed = await seed(db, 'malformed', 1);
    await processUserOnce('malformed', db, { ...deps, send: async () => new Response('not-json', { status: 200 }) });
    assert.equal((await db.collection('deliveries').findOne({ campaignId: malformed }))?.status, 'accepted');

    const stale = await seed(db, 'stale', 1);
    await processUserOnce('stale', db, { ...deps, accessToken: async () => {
      await db.collection('sender_locks').updateOne({ userId: 'stale' }, { $set: { owner: 'new-owner' } });
      return 'fake-token';
    } });
    assert.equal((await db.collection('deliveries').findOne({ campaignId: stale }))?.status, 'sending');
    assert.equal(sends, 4, 'lost lock is fenced before Gmail call');

    // Publication failure leaves campaign and all recipient reservations intact.
    const pending = await seed(db, 'pending', 1);
    const failedPublish = async () => { throw new Error('queue-down'); };
    assert.equal(await dispatchCampaign(pending, 'pending', db, failedPublish, true), 'pending');
    assert.equal(await db.collection('deliveries').countDocuments({ campaignId: pending }), 1);
    const published: unknown[] = [];
    const publish = (async (...args: unknown[]) => { published.push(args); return { messageId: 'fake-message' }; }) as Parameters<typeof dispatchCampaign>[3];
    assert.equal(await dispatchCampaign(pending, 'pending', db, publish, true), 'published');
    assert.deepEqual((published[0] as unknown[])[1], { campaignId: pending.toHexString() });
    assert.equal((await db.collection('campaigns').findOne({ _id: pending }))?.queueDispatchError, null);
    assert.equal(await dispatchCampaign(pending, 'other-user', db, publish, true), 'pending');
    assert.equal(published.length, 1, 'cannot publish another owner campaign');
    assert.equal(await dispatchCampaign(new ObjectId(), 'pending', db, publish, true), 'pending');
    assert.equal(published.length, 1, 'missing campaign does not publish');
    // Simulate a DB failure only on the post-publication status write.
    const flakyDb = new Proxy(db, { get(target, key) {
      if (key === 'collection') return (name: string) => {
        const collection = target.collection(name);
        return new Proxy(collection, { get(coll, prop) {
          if (prop === 'updateOne') return async () => { throw new Error('database unavailable'); };
          const value = Reflect.get(coll, prop);
          return typeof value === 'function' ? value.bind(coll) : value;
        } });
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    assert.equal(await dispatchCampaign(pending, 'pending', flakyDb, publish, true), 'published');
    assert.equal(await db.collection('deliveries').countDocuments({ campaignId: pending }), 1);

  } finally {
    await db.dropDatabase();
    await client.close();
  }
});

async function seed(db: Db, userId: string, count: number) {
  const campaignId = new ObjectId();
  await db.collection('campaigns').insertOne({ _id: campaignId, userId, senderAddress: 'sender@example.com', resumeSnapshotFileId: new ObjectId(), status: 'queued', totals: { queued: count, accepted: 0, failed: 0, uncertain: 0, skipped: 0 } });
  await db.collection('deliveries').insertMany(Array.from({ length: count }, (_, i) => ({ userId, campaignId, to: `${i}@example.com`, renderedSubject: 'Hello', renderedBody: 'Test', status: 'queued', attemptCount: 0 })));
  return campaignId;
}
