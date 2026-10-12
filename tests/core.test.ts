import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContactCsv } from '../lib/core/csv';
import { renderTemplate, validateTemplate } from '../lib/core/validation';
import { parseCampaignInput } from '../lib/core/campaigns';

test('personalization replaces only approved fields and rejects unknown placeholders', () => {
  validateTemplate('Hello {{recruiterName}}', 'I am interested in {{companyName}}. Regards, {{senderName}}');
  assert.equal(renderTemplate('Hi {{ recruiterName }} at {{companyName}}', { recruiterName: 'Asha', companyName: 'Orbit', senderName: 'Dev' }), 'Hi Asha at Orbit');
  assert.throws(() => validateTemplate('Hi {{email}}', 'Body'), /Unsupported placeholder/);
  assert.throws(() => validateTemplate('Hi\r\nBcc: x', 'Body'), /one line/);
});

test('CSV accepts BOM and quoted commas while isolating invalid rows', () => {
  const csv = '\uFEFFemail,recruiterName,companyName\nasha@example.com,"Asha, R","Orbit, Inc"\nbad-address,Bad,Co\n';
  const result = parseContactCsv(csv);
  assert.deepEqual(result.rows.map(row => ({ email: row.emailNormalized, name: row.recruiterName, company: row.companyName })), [
    { email: 'asha@example.com', name: 'Asha, R', company: 'Orbit, Inc' },
  ]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row, 3);
});

test('campaign input rejects repeated contacts and oversized recipient sets', () => {
  const contact = '507f1f77bcf86cd799439011';
  const base = { name: 'My outreach', templateId: contact, resumeId: contact };
  assert.throws(() => parseCampaignInput({ ...base, contactIds: [contact, contact] }), /Select each contact once/);
  assert.throws(() => parseCampaignInput({ ...base, contactIds: Array.from({ length: 21 }, (_, i) => `507f1f77bcf86cd7994390${String(i).padStart(2, '0')}`) }), /Choose 1 to 20 contacts/);
});

test('CSV gives actionable errors for missing, duplicate, and empty headers', () => {
  assert.throws(() => parseContactCsv('wrong,columns\na,b'), /CSV headers must include/);
  assert.throws(() => parseContactCsv('email,recruiterName,companyName,email\na@b.com,A,B,a@b.com'), /without duplicates/);
  assert.throws(() => parseContactCsv('email,recruiterName,companyName\n'), /no contact rows/);
});
