import { randomBytes } from 'node:crypto';
import { formatEmailBody } from '../core/email-body';

const SINGLE_EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;
const CRLF = '\r\n';

function base64Lines(bytes: Buffer): string {
  const base64 = bytes.toString('base64');
  return base64.match(/.{1,76}/g)?.join(CRLF) ?? '';
}

function encodeSubject(value: string): string {
  // RFC 2047 encoded words are limited to 75 characters including framing.
  const bytes = Buffer.from(value, 'utf8');
  const words: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + 42, bytes.length);
    // Do not split a UTF-8 character between encoded words.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === start) end = Math.min(start + 1, bytes.length);
    words.push(`=?UTF-8?B?${bytes.subarray(start, end).toString('base64')}?=`);
    start = end;
  }
  return words.join(`${CRLF} `);
}

export async function buildRawMime(input: {
  from: string;
  to: string;
  subject: string;
  body: string;
  /** null keeps legacy queued messages plain text; otherwise use approved HTML. */
  bodyHtml?: string | null;
  pdf: Buffer;
}): Promise<string> {
  if (!SINGLE_EMAIL.test(input.from) || !SINGLE_EMAIL.test(input.to)) throw new Error('invalid_email_address');
  if (!input.subject.trim() || /[\r\n]/.test(input.subject)) throw new Error('invalid_subject');
  if (!input.pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error('invalid_pdf');
  const boundary = `hirehello_${randomBytes(18).toString('hex')}`;
  const alternative = `alternative_${randomBytes(18).toString('hex')}`;
  const html = input.bodyHtml === undefined ? formatEmailBody(input.body) : input.bodyHtml;
  const textPart = [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', base64Lines(Buffer.from(input.body, 'utf8')),
  ];
  const bodyParts = html === null ? textPart : [
    `Content-Type: multipart/alternative; boundary="${alternative}"`, '',
    `--${alternative}`, ...textPart,
    `--${alternative}`, 'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64', '', base64Lines(Buffer.from(html, 'utf8')),
    `--${alternative}--`, '',
  ];
  const mime = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeSubject(input.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    ...bodyParts,
    `--${boundary}`,
    'Content-Type: application/pdf; name="resume.pdf"',
    'Content-Disposition: attachment; filename="resume.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(input.pdf),
    `--${boundary}--`,
    '',
  ].join(CRLF);
  return Buffer.from(mime, 'utf8').toString('base64url');
}

export async function sendRawWithGmail(accessToken: string, raw: string, sendFetch: typeof fetch = fetch): Promise<Response> {
  return sendFetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
    signal: AbortSignal.timeout(30_000),
  });
}
