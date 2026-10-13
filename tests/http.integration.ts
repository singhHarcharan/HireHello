/** Real Next.js HTTP tests against a fresh, disposable localhost Mongo database. No Gmail sends. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MongoClient, ObjectId, GridFSBucket } from 'mongodb';
import { encode } from 'next-auth/jwt';

async function main() {
const uri = process.env.MONGODB_TEST_URI || 'mongodb://127.0.0.1:27017';
assert.match(uri, /^mongodb:\/\/(127\.0\.0\.1|localhost)(:|\/)/, 'HTTP tests must use localhost MongoDB');
const dbName = `hirehello_http_test_${randomUUID().replaceAll('-', '')}`;
const secret = randomUUID();
const base = 'http://localhost:3101';
const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--port', '3101'], {
  env: { ...process.env, NODE_ENV: 'development', MONGODB_URI: uri, MONGODB_DB: dbName,
    NEXTAUTH_SECRET: secret, NEXTAUTH_URL: base, VERCEL: undefined, GOOGLE_CLIENT_ID: 'test', GOOGLE_CLIENT_SECRET: 'test',
    GMAIL_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') }, stdio: ['ignore','pipe','pipe'],
});
let log = ''; server.stdout.on('data', d => { log = (log + String(d)).slice(-6000); }); server.stderr.on('data', d => { log = (log + String(d)).slice(-6000); });
const owner = 'qa-http-owner'; const other = 'qa-http-other';
const cookies = new Map<string,string>();
for (const user of [owner, other]) cookies.set(user, `next-auth.session-token=${await encode({ secret, token: { sub:user, name:'QA Tester', email:`${user}@example.com` }, maxAge:3600 })}`);
let checks = 0;
async function request(path: string, method = 'GET', body?: unknown, user: string | null = owner, headers: Record<string,string> = {}) {
  const multipart = body instanceof FormData;
  const response = await fetch(base + path, { method, headers: { ...(user ? { Cookie: cookies.get(user)! } : {}),
    ...(body !== undefined && !multipart ? {'Content-Type':'application/json'} : {}), Origin: base, ...headers },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body), redirect:'manual' });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
function status(result: {status:number;data:unknown}, expected: number, label: string) { assert.equal(result.status, expected, `${label}: ${JSON.stringify(result.data)}`); checks++; console.log(`PASS ${label}`); }
try {
  const deadline = Date.now()+60000;
  while (true) { try { await fetch(base+'/signin'); break; } catch { if(server.exitCode !== null || Date.now()>deadline) throw new Error('Test server failed to start: '+log); await new Promise(r=>setTimeout(r,300)); } }
  for(const path of ['/api/templates','/api/resumes','/api/contacts','/api/campaigns','/api/gmail/connection']) status(await request(path,'GET',undefined,null),401,`anonymous blocked ${path}`);
  status(await request('/api/contacts','POST',{},owner,{Origin:'https://untrusted.example'}),403,'cross-origin mutation blocked');
  status(await request('/api/templates','POST',{name:'QA',subject:'{{unknown}}',bodyText:'body'}),400,'unsupported merge fields rejected');
  const template = await request('/api/templates','POST',{name:'QA template',subject:'Hello {{companyName}}',bodyText:'Hi {{recruiterName}}, from {{senderName}}'}); status(template,201,'create template');
  const tid = template.data.template.id;
  assert.equal((await request('/api/templates','GET',undefined,other)).data.templates.length,0); checks++;
  status(await request(`/api/templates/${tid}`,'PATCH',{subject:'no'},other),404,'other account cannot edit template');
  const badFile=new FormData();badFile.set('label','bad');badFile.set('file',new Blob(['not a PDF'],{type:'application/pdf'}),'bad.pdf'); status(await request('/api/resumes','POST',badFile),400,'fake PDF rejected');
  const form = new FormData(); form.set('label','QA attachment'); form.set('file',new Blob(['%PDF-1.4\nQA HTTP fixture\n%%EOF'],{type:'application/pdf'}),'qa.pdf');
  const resume = await request('/api/resumes','POST',form);status(resume,201,'upload PDF');const rid=resume.data.resume.id;
  assert.equal((await request('/api/resumes','GET',undefined,other)).data.resumes.length,0); checks++;
  status(await request(`/api/resumes/${rid}`,'DELETE',undefined,other),404,'other account cannot delete PDF');
  const contact = await request('/api/contacts','POST',{email:'QA@EXAMPLE.COM',recruiterName:'QA Recruiter',companyName:'QA Co'});status(contact,201,'create normalized contact'); const cid=contact.data.contact.id;
  status(await request('/api/contacts','POST',{email:'qa@example.com',recruiterName:'Dup',companyName:'Dup'}),409,'case-insensitive duplicate blocked');
  status(await request(`/api/contacts/${cid}`,'PATCH',{recruiterName:'Other'},other),404,'other account cannot edit contact');
  status(await request('/api/contacts/not-an-id','DELETE'),400,'invalid identifier is a user error');
  const input={name:'QA campaign',templateId:tid,resumeId:rid,contactIds:[cid]};
  status(await request('/api/campaigns/preview','POST',input),409,'disconnected Gmail blocks preview');
  await db.collection('google_grants').insertOne({userId:owner,status:'connected',gmailAddress:'qa-sender@example.com',encryptedRefreshToken:'not-a-real-token'});
  let preview = await request('/api/campaigns/preview','POST',input); status(preview,200,'personalized preview'); assert.equal(preview.data.previews[0].subject,'Hello QA Co');assert.equal(preview.data.previews[0].bodyText,'Hi QA Recruiter, from QA Tester');checks++;
  status(await request('/api/campaigns/preview','POST',input,other),404,'other account cannot preview private materials');
  const key=randomUUID();
  status(await request('/api/campaigns','POST',input,owner,{'Idempotency-Key':key}),409,'sending without a reviewed token blocked');
  await request(`/api/templates/${tid}`,'PATCH',{subject:'Updated {{companyName}}'});
  status(await request('/api/campaigns','POST',{...input,previewToken:preview.data.previewToken},owner,{'Idempotency-Key':key}),409,'stale template preview blocked');
  status(await request('/api/campaigns/test','POST',{...input,previewToken:preview.data.previewToken},owner,{'Idempotency-Key':randomUUID()}),409,'stale self-test preview blocked before Gmail');
  preview=await request('/api/campaigns/preview','POST',input);
  await request(`/api/contacts/${cid}`,'PATCH',{companyName:'Revised Co'});
  status(await request('/api/campaigns','POST',{...input,previewToken:preview.data.previewToken},owner,{'Idempotency-Key':key}),409,'stale contact preview blocked');
  preview=await request('/api/campaigns/preview','POST',input);
  const payload={...input,previewToken:preview.data.previewToken};
  const campaign=await request('/api/campaigns','POST',payload,owner,{'Idempotency-Key':key});status(campaign,201,'campaign queues locally without sending'); const campaignId=campaign.data.campaign.id;
  const replay=await request('/api/campaigns','POST',payload,owner,{'Idempotency-Key':key});status(replay,200,'same approval safely replays');assert.equal(replay.data.campaign.id,campaignId);checks++;
  status(await request('/api/campaigns','POST',{...payload,name:'Changed'},owner,{'Idempotency-Key':key}),409,'idempotency conflict blocked');
  status(await request(`/api/campaigns/${campaignId}`,'GET',undefined,other),404,'other account cannot read campaign');
  for (const action of ['pause','resume','dispatch']) assert.notEqual((await request(`/api/campaigns/${campaignId}/${action}`,'POST',undefined,other)).status,200);
  checks++;
  const contacts=(await request('/api/contacts')).data.contacts;assert.equal(contacts.find((c:{id:string})=>c.id===cid).outreachStatus,'scheduled');checks++;
  assert.equal((await request('/api/campaigns/preview','POST',input)).data.previews.length,0);checks++;
  status(await request(`/api/campaigns/${campaignId}/pause`,'POST'),200,'pause campaign');
  status(await request(`/api/campaigns/${campaignId}/resume`,'POST'),200,'resume campaign');
  status(await request(`/api/campaigns/${campaignId}/dispatch`,'POST'),200,'restart scheduling');
  status(await request(`/api/campaigns/${campaignId}/dispatch`,'POST'),429,'scheduling recovery rate limited');
  const delivery=await db.collection('deliveries').findOne({campaignId:new ObjectId(campaignId)});assert.ok(delivery);
  assert.equal(delivery.renderedHtml, preview.data.previews[0].bodyHtml); assert.match(delivery.renderedHtml, /QA Tester/); checks++;
  status(await request(`/api/deliveries/${delivery._id}/retry`,'POST'),409,'queued delivery cannot be duplicated by retry');
  await db.collection('deliveries').updateOne({_id:delivery._id},{$set:{status:'uncertain'}});
  status(await request(`/api/deliveries/${delivery._id}/retry`,'POST'),409,'uncertain delivery cannot be resent');
  await db.collection('deliveries').updateOne({_id:delivery._id},{$set:{status:'accepted',sentAt:new Date()}});
  assert.equal((await request('/api/contacts')).data.contacts[0].outreachStatus,'contacted');checks++;
  const resendInput={...input,sendMode:'resend'};
  assert.equal((await request('/api/campaigns/preview','POST',input)).data.previews.length,0); checks++;
  const resendPreview=await request('/api/campaigns/preview','POST',resendInput);status(resendPreview,200,'explicit resend preview');
  assert.equal(resendPreview.data.previews[0].previousDeliveryId,delivery._id.toHexString());checks++;
  status(await request('/api/campaigns','POST',{...input,previewToken:resendPreview.data.previewToken},owner,{'Idempotency-Key':randomUUID()}),409,'resend approval cannot be reused as first contact');
  const resendPayload={...resendInput,previewToken:resendPreview.data.previewToken};
  const resendKeys=[randomUUID(),randomUUID()];
  const competing=await Promise.all(resendKeys.map(k=>request('/api/campaigns','POST',resendPayload,owner,{'Idempotency-Key':k})));
  assert.deepEqual(competing.map(r=>r.status).sort(),[201,409]);checks++;console.log('PASS concurrent resends enqueue once');
  const winnerIndex=competing.findIndex(r=>r.status===201);
  const repeatCampaign=competing[winnerIndex].data.campaign;
  status(await request('/api/campaigns','POST',resendPayload,owner,{'Idempotency-Key':resendKeys[winnerIndex]}),200,'resend safely replays');
  status(await request('/api/campaigns','POST',{...resendPayload,sendMode:'first_contact'},owner,{'Idempotency-Key':resendKeys[winnerIndex]}),409,'idempotency binds send mode');
  assert.equal((await request('/api/contacts')).data.contacts[0].outreachStatus,'scheduled');checks++;
  assert.equal((await request('/api/campaigns/preview','POST',resendInput)).data.previews.length,0);checks++;
  const repeat=await db.collection('deliveries').findOne({campaignId:new ObjectId(repeatCampaign.id)});assert.ok(repeat);
  await db.collection('deliveries').updateOne({_id:repeat._id},{$set:{status:'uncertain'}});
  assert.equal((await request('/api/contacts')).data.contacts[0].outreachStatus,'needs_review');checks++;
  assert.equal((await request('/api/campaigns/preview','POST',resendInput)).data.previews.length,0);checks++;
  await db.collection('deliveries').updateOne({_id:repeat._id},{$set:{status:'accepted',sentAt:new Date()}});
  status(await request('/api/campaigns','POST',resendPayload,owner,{'Idempotency-Key':randomUUID()}),409,'stale resend approval blocked after acceptance');
  const nextPreview=await request('/api/campaigns/preview','POST',resendInput);
  assert.equal(nextPreview.data.previews[0].previousDeliveryId,repeat._id.toHexString());checks++;
  assert.equal(await db.collection('deliveries').countDocuments({userId:owner,status:'accepted'}),2);checks++;
  status(await request(`/api/contacts/${cid}`,'DELETE'),200,'remove disposable contact');
  const replacement=await request('/api/contacts','POST',{email:'qa@example.com',recruiterName:'Reimport',companyName:'Reimport'});status(replacement,201,'reimport contacted address');assert.equal((await request('/api/contacts')).data.contacts[0].outreachStatus,'contacted');checks++;
  status(await request(`/api/contacts/${replacement.data.contact.id}/suppress`,'POST'),200,'suppress address');
  assert.equal((await request('/api/campaigns/preview','POST',{...resendInput,contactIds:[replacement.data.contact.id]})).data.previews.length,0);checks++;
  const csv=new FormData();csv.set('file',new Blob(['email,recruiterName,companyName\nqa@example.com,Blocked,Co\nother@example.com,Other,Co\nOTHER@example.com,Dup,Co\nbad,Invalid,Co'],{type:'text/csv'}),'qa.csv');
  const imported=await request('/api/contacts/import','POST',csv);status(imported,200,'mixed CSV accepted');assert.deepEqual([imported.data.valid,imported.data.duplicate,imported.data.invalid,imported.data.suppressed],[1,1,1,1]);checks++;
  const stored=await db.collection('campaigns').findOne({_id:new ObjectId(campaignId)});assert.ok(stored?.resumeSnapshotFileId);
  status(await request(`/api/resumes/${rid}`,'DELETE'),200,'delete source résumé');
  const chunks=[];for await(const chunk of new GridFSBucket(db,{bucketName:'resumeFiles'}).openDownloadStream(stored.resumeSnapshotFileId))chunks.push(chunk);
  assert.ok(Buffer.concat(chunks).toString().includes('QA HTTP fixture'));checks++;
  assert.equal(await db.collection('test_sends').countDocuments({}),0);checks++;
  console.log(`PASS ${checks} HTTP assertions. No real email sent.`);
} finally {
  server.kill('SIGTERM'); if(server.exitCode===null)await Promise.race([once(server,'exit'),new Promise(r=>setTimeout(r,3000))]);
  await db.dropDatabase();await client.close();
}

}
void main().catch(error => { console.error(error); process.exitCode = 1; });
