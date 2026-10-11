import { Db, GridFSBucket, MongoClient } from 'mongodb';

let clientPromise: Promise<MongoClient> | undefined;
let indexesPromise: Promise<void> | undefined;

export async function getMongoClient(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  clientPromise ??= new MongoClient(uri).connect().catch(error => {
    clientPromise = undefined;
    throw error;
  });
  return clientPromise;
}

export async function getDb(): Promise<Db> {
  const db = (await getMongoClient()).db(process.env.MONGODB_DB || 'hirehello');
  indexesPromise ??= ensureIndexes(db).catch(error => {
    indexesPromise = undefined;
    throw error;
  });
  await indexesPromise;
  return db;
}

export async function getResumeBucket(): Promise<GridFSBucket> {
  return new GridFSBucket(await getDb(), { bucketName: 'resumeFiles' });
}

async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all([
    db.collection('users').createIndex({ googleSub: 1 }, { unique: true }),
    db.collection('google_grants').createIndex({ userId: 1 }, { unique: true }),
    db.collection('gmail_oauth_attempts').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    db.collection('resumes').createIndex({ userId: 1, createdAt: -1 }),
    db.collection('templates').createIndex({ userId: 1, updatedAt: -1 }),
    db.collection('contacts').createIndex({ userId: 1, emailNormalized: 1 }, { unique: true }),
    db.collection('suppressions').createIndex({ userId: 1, emailNormalized: 1 }, { unique: true }),
    db.collection('campaigns').createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true }),
    db.collection('campaigns').createIndex({ userId: 1, createdAt: -1 }),
    db.collection('deliveries').createIndex({ campaignId: 1, contactId: 1 }, { unique: true }),
    db.collection('deliveries').createIndex({ userId: 1, to: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['queued', 'sending', 'accepted', 'uncertain'] } } }),
    db.collection('deliveries').createIndex({ status: 1, leaseUntil: 1 }),
    db.collection('deliveries').createIndex({ userId: 1, campaignId: 1 }),
    db.collection('test_sends').createIndex({ userId: 1, idempotencyKey: 1 }, { unique: true }),
    db.collection('test_sends').createIndex({ userId: 1, createdAt: -1 }),
  ]).then(() => undefined);
}
