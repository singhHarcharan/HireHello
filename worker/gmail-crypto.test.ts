import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { encryptRefreshToken, decryptRefreshToken } from '../lib/gmail/crypto';

test('refresh token encryption authenticates ciphertext and uses a fresh nonce', () => {
  const previous = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  process.env.GMAIL_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  try {
    const first = encryptRefreshToken('test-refresh-token');
    const second = encryptRefreshToken('test-refresh-token');
    assert.notEqual(first, second);
    assert.equal(decryptRefreshToken(first), 'test-refresh-token');
    const parts = first.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    assert.throws(() => decryptRefreshToken(parts.join('.')));
  } finally {
    if (previous === undefined) delete process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
    else process.env.GMAIL_TOKEN_ENCRYPTION_KEY = previous;
  }
});
