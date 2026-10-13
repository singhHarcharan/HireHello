import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatEmailBody, insertMergeField, normalizeEmailText } from '../lib/core/email-body';

test('pasted prose reflows, paragraphs and short signature lines stay separate', () => {
  const first = 'I build reliable backend services and useful internal tools for';
  const body = `Dear Maya,\r\n\r\n${first}\r\ngrowing teams.\r\n\r\nBest,\r\nAlex Example`;
  const html = formatEmailBody(body);
  assert.ok(html.includes(`${first} growing teams.`));
  assert.ok(html.includes('Best,<br>Alex Example'));
  assert.equal((html.match(/<p /g) || []).length, 3);
  assert.ok(formatEmailBody(`${first}  \nthis line is intentional`).includes(`${first}<br>this line`));
  assert.equal(normalizeEmailText('a\n\n\n\nb'), 'a\n\nb');
});

test('bullets and ordered lists get hanging indents, preserve numbering and unwrap continuation', () => {
  const html = formatEmailBody('Recent work:\n•Built internal tools that helped a distributed engineering team\nreduce repetitive tasks by 30%.\n•Shipped an integration.\n\n3. Backend systems\n4. Developer tools');
  assert.match(html, /<ul /);
  assert.match(html, /<ol /);
  assert.equal((html.match(/<li[ >]/g) || []).length, 4);
  assert.match(html, /engineering team reduce repetitive/);
  assert.match(html, /value="3"/);
  assert.match(html, /Recent work:<\/p>/);
});

test('labelled links keep complete destinations and untrusted markup is escaped', () => {
  const html = formatEmailBody('Résumé: https://example.com/cv?id=123&share=yes\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\nhttps://example.com/path?q=%22%3E\n[bad](javascript:alert(1))');
  // Non-ASCII labels remain harmless text; ASCII labels become concise links.
  const labelled = formatEmailBody('Resume: https://example.com/cv?id=123&share=yes');
  assert.match(labelled, /href="https:\/\/example.com\/cv\?id=123&amp;share=yes"/);
  assert.match(labelled, />Resume<\/a>/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(formatEmailBody('See https://example.com/a.').includes('>example.com/a</a>.'));
});

test('merge field inserts at cursor or replaces selected text without duplicating the signature', () => {
  const body = 'Hi Maya,\n\nBest,\nAlex';
  const inserted = insertMergeField(body, 'recruiterName', 3, 7);
  assert.equal(inserted.text, 'Hi {{recruiterName}},\n\nBest,\nAlex');
  assert.equal(inserted.caret, 20);
  assert.equal(insertMergeField('Hi ,', 'recruiterName', 3, 3).text, 'Hi {{recruiterName}},');
});
