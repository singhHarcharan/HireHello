import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignNotifications } from '../lib/core/campaign-notifications';
const queued = { id: 'c1', name: 'Engineering roles', status: 'queued', totals: { queued: 2, accepted: 0, failed: 0, uncertain: 0 } };
test('initial history and unchanged polls are quiet; changes notify only once', () => {
  assert.deepEqual(campaignNotifications(null, [queued]), []);
  assert.deepEqual(campaignNotifications([queued], [queued]), []);
  const progressed = { ...queued, totals: { ...queued.totals, accepted: 1, queued: 1 } };
  assert.equal(campaignNotifications([queued], [progressed]).length, 1);
  assert.deepEqual(campaignNotifications([progressed], [progressed]), []);
  assert.equal(campaignNotifications([], [queued]).length, 1);
});
test('a completed campaign with uncertain results is not reported as success', () => {
  const finished = { ...queued, status: 'completed', totals: { queued: 0, accepted: 1, failed: 0, uncertain: 1 } };
  const notices = campaignNotifications([queued], [finished]);
  assert.equal(notices.length, 1);
  assert.equal(notices[0].tone, 'error');
  assert.match(notices[0].message, /1 need review/);
});
test('automatic pause and queue publication failure are surfaced without recipient details', () => {
  assert.match(campaignNotifications([queued], [{ ...queued, status: 'paused' }])[0].message, /paused/);
  const pending = { ...queued, queueDispatchStatus: 'pending' };
  assert.equal(campaignNotifications([queued], [pending])[0].tone, 'error');
  assert.deepEqual(campaignNotifications([pending], [pending]), []);
});
