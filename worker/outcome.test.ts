import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyGmailFailure } from './outcome';

test('reconnects after revoked or insufficient Gmail authorization', () => {
  assert.equal(classifyGmailFailure(401, undefined, 1), 'reconnect');
  assert.equal(classifyGmailFailure(403, 'insufficientPermissions', 1), 'reconnect');
});

test('pauses sending after Gmail daily or user limit', () => {
  assert.equal(classifyGmailFailure(403, 'userRateLimitExceeded', 1), 'pause_limit');
  assert.equal(classifyGmailFailure(403, 'dailyLimitExceeded', 1), 'pause_limit');
});

test('retries explicit throttling only within attempt cap', () => {
  assert.equal(classifyGmailFailure(429, undefined, 1), 'retry');
  assert.equal(classifyGmailFailure(500, undefined, 2), 'retry');
  assert.equal(classifyGmailFailure(429, undefined, 3), 'fail');
  assert.equal(classifyGmailFailure(400, undefined, 1), 'fail');
});
