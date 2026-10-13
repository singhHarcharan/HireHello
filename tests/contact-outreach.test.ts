import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from 'mongodb';
import { ensureDeliveryIndexes } from '../lib/core/delivery-indexes';
import { contactOutreach, getContactOutreach, RESERVED_DELIVERY_STATUSES } from '../lib/core/contact-outreach';

test('contact lifecycle distinguishes success, reserved sends, known failures, and suppression', () => {
  assert.equal(contactOutreach(false).outreachStatus, 'ready');
  for (const status of ['queued', 'sending']) assert.equal(contactOutreach(false, { status }).outreachStatus, 'scheduled');
  assert.equal(contactOutreach(false, { status: 'uncertain' }).outreachStatus, 'needs_review');
  for (const status of ['failed', 'skipped']) assert.equal(contactOutreach(false, { status }).outreachStatus, 'ready');
  const sentAt = new Date();
  const campaignId = new ObjectId();
  assert.deepEqual(contactOutreach(false, { status: 'accepted', sentAt, campaignId }), { outreachStatus: 'contacted', contactedAt: sentAt, campaignId: campaignId.toHexString() });
  assert.equal(contactOutreach(true, { status: 'accepted' }).outreachStatus, 'blocked');
});

// Opt in with MONGODB_TEST_URI. Creates and drops only a fresh, randomly named test database.
test('MongoDB lifecycle follows worker outcomes, isolates owners, and survives contact replacement', { skip: !process.env.MONGODB_TEST_URI }, async () => {
  const client = await new MongoClient(process.env.MONGODB_TEST_URI!).connect();
  const db = client.db(`hirehello_test_outreach_${new ObjectId().toHexString()}`);
  try {
    const userId = 'test-owner';
    const emailNormalized = 'recruiter@example.com';
    const contact = { userId, emailNormalized, status: 'active' };
    const campaignId = new ObjectId();
    await db.collection('deliveries').createIndex({ userId: 1, to: 1 }, { unique: true, partialFilterExpression: { status: { $in: RESERVED_DELIVERY_STATUSES } } });
    await ensureDeliveryIndexes(db);
    await ensureDeliveryIndexes(db); // Repeated cold starts are safe.
    let contactId = (await db.collection('contacts').insertOne({ ...contact })).insertedId;
    const read = async (owner = userId) => getContactOutreach(db, owner, await db.collection<typeof contact>('contacts').find({ userId: owner }).toArray());
    assert.equal((await read()).get(emailNormalized)?.outreachStatus, 'ready');
    const deliveryId = (await db.collection('deliveries').insertOne({ userId, to: emailNormalized, status: 'queued', campaignId })).insertedId;
    for (const [status, expected] of [['queued','scheduled'],['sending','scheduled'],['uncertain','needs_review'],['failed','ready'],['skipped','ready'],['accepted','contacted']]) {
      await db.collection('deliveries').updateOne({ _id: deliveryId }, { $set: { status } });
      assert.equal((await read()).get(emailNormalized)?.outreachStatus, expected);
    }
    // Removing/reimporting a contact (a new ID) must not turn an accepted email into a fresh recipient.
    await db.collection('contacts').deleteOne({ _id: contactId });
    contactId = (await db.collection('contacts').insertOne({ ...contact })).insertedId;
    assert.ok(contactId);
    assert.equal((await read()).get(emailNormalized)?.outreachStatus, 'contacted');
    await assert.rejects(db.collection('deliveries').insertOne({ userId, to: emailNormalized, status: 'queued', campaignId: new ObjectId() }), { code: 11000 });
    // An explicitly reviewed resend reserves a new generation without losing history.
    const resend = { userId, to: emailNormalized, status: 'queued', campaignId: new ObjectId(), previousDeliveryId: deliveryId };
    const competing = await Promise.allSettled([db.collection('deliveries').insertOne({ ...resend }), db.collection('deliveries').insertOne({ ...resend })]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await read()).get(emailNormalized)?.outreachStatus, 'scheduled');
    const repeat = await db.collection('deliveries').findOne({ previousDeliveryId: deliveryId }); assert.ok(repeat);
    await db.collection('deliveries').updateOne({ _id: repeat._id }, { $set: { status: 'uncertain' } });
    assert.equal((await read()).get(emailNormalized)?.outreachStatus, 'needs_review');
    await assert.rejects(db.collection('deliveries').insertOne({ ...resend, previousDeliveryId: new ObjectId() }), { code: 11000 });
    await db.collection('deliveries').updateOne({ _id: repeat._id }, { $set: { status: 'failed' } });
    assert.equal((await read()).get(emailNormalized)?.outreachStatus, 'contacted');
    await db.collection('deliveries').updateOne({ _id: repeat._id }, { $set: { status: 'accepted', sentAt: new Date() } });
    // Even after a fast acceptance, stale approvals for the same generation cannot repeat.
    await assert.rejects(db.collection('deliveries').insertOne({ ...resend }), { code: 11000 });
    assert.equal(await db.collection('deliveries').countDocuments({ userId, status: 'accepted' }), 2);
    assert.equal((await read()).get(emailNormalized)?.campaignId, repeat.campaignId.toHexString());
    await db.collection('contacts').insertOne({ ...contact, userId: 'other-owner' });
    assert.equal((await read('other-owner')).get(emailNormalized)?.outreachStatus, 'ready');
    // Suppression is authoritative even if a contact's status write has not yet completed.
    await db.collection('suppressions').insertOne({ userId, emailNormalized });
    assert.equal((await read()).get(emailNormalized)?.outreachStatus, 'blocked');
    assert.equal((await read('other-owner')).get(emailNormalized)?.outreachStatus, 'ready');
    assert.equal((await getContactOutreach(db, userId, [])).size, 0);
  } finally {
    await db.dropDatabase();
    await client.close();
  }
});
