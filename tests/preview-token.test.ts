import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewToken, requireCurrentPreview } from '../lib/core/preview-token';

test('review approval binds owner, sender, recipients, text, and attachment', () => {
  const previous = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = 'test-only-preview-secret';
  try {
    const input={name:'QA',templateId:'t',resumeId:'r',contactIds:['c']};
    const prepared={senderAddress:'sender@example.com',resume:{sha256:'abc',size:100,label:'PDF'},previews:[{to:'to@example.com',subject:'Hello',bodyText:'Original'}],skipped:[]};
    const token=createPreviewToken('owner',input,prepared);
    requireCurrentPreview(token,createPreviewToken('owner',input,prepared));
    for(const next of [
      {...prepared,senderAddress:'another@example.com'},
      {...prepared,resume:{...prepared.resume,sha256:'changed'}},
      {...prepared,previews:[{...prepared.previews[0],to:'changed@example.com'}]},
      {...prepared,previews:[{...prepared.previews[0],bodyText:'Unreviewed'}]},
      {...prepared,skipped:[{contactId:'c',reason:'blocked'}]},
    ]) assert.throws(()=>requireCurrentPreview(token,createPreviewToken('owner',input,next)),/Preview every message again/);
    assert.throws(()=>requireCurrentPreview(token,createPreviewToken('other',input,prepared)),/Preview every message again/);
    assert.throws(()=>requireCurrentPreview(undefined,token),/Preview every message again/);
  } finally { if(previous===undefined)delete process.env.NEXTAUTH_SECRET;else process.env.NEXTAUTH_SECRET=previous; }
});
