import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRawMime, sendRawWithGmail } from '../lib/gmail/send';

const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');

test('one recipient receives personalized plain-text MIME with PDF attachment', async () => {
  const raw = await buildRawMime({
    from: 'candidate@example.com', to: 'recruiter@example.com',
    subject: 'Hello Acme', body: 'Hi Maya,\nI would like to work at Acme.', pdf,
  });
  const mime = Buffer.from(raw, 'base64url').toString('utf8');
  assert.match(mime, /To: recruiter@example\.com/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?SGVsbG8gQWNtZQ==\?=/);
  assert.match(mime, /Content-Type: text\/plain/);
  assert.match(mime, /Content-Type: application\/pdf/);
  assert.match(mime, /filename="resume\.pdf"/);
  assert.ok(mime.includes(Buffer.from('Hi Maya,\nI would like to work at Acme.').toString('base64')));
  assert.ok(mime.includes(pdf.toString('base64')));
  assert.ok(!mime.includes('another@example.com'));
});

test('Gmail sender posts base64url MIME once with the bearer token', async () => {
  const raw = await buildRawMime({ from: 'candidate@example.com', to: 'recruiter@example.com', subject: 'Hi', body: 'Hello', pdf });
  let calls = 0;
  const stub: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
    assert.equal(JSON.parse(String(init?.body)).raw, raw);
    return Response.json({ id: 'gmail-123' });
  };
  const result = await sendRawWithGmail('test-token', raw, stub);
  assert.equal(calls, 1);
  assert.equal((await result.json()).id, 'gmail-123');
});

test('rejects address injection and multiple recipients', async () => {
  await assert.rejects(buildRawMime({ from: 'candidate@example.com', to: 'one@example.com,two@example.com', subject: 'Hi', body: 'Hello', pdf }), /invalid_email_address/);
  await assert.rejects(buildRawMime({ from: 'candidate@example.com', to: 'one@example.com', subject: 'Hi\r\nBcc: evil@example.com', body: 'Hello', pdf }), /invalid_subject/);
});
