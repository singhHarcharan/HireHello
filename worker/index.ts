import { loadEnvConfig } from '@next/env';
import { getDb } from '../lib/db';
import { processUserOnce } from './processor';

loadEnvConfig(process.cwd());
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function run() {
  while (true) {
    try {
      const db = await getDb();
      const users = await db.collection('campaigns').distinct('userId', { status: 'queued' });
      for (const userId of users) await processUserOnce(userId, db);
    } catch (error) {
      console.error('Worker iteration failed:', error instanceof Error ? error.name : 'unknown error');
    }
    await sleep(Math.max(1000, Number(process.env.WORKER_POLL_MS) || 3000));
  }
}
run().catch(() => { console.error('Worker failed to start'); process.exit(1); });
