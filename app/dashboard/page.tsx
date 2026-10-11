"use client";

import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, json, newIdempotencyKey, type Campaign, type Contact, type Delivery, type Preview, type Resume, type Template } from "@/app/components/hirehello/api";

type Tab = "overview" | "materials" | "contacts" | "compose" | "campaigns";
type Connection = { connected: boolean; email?: string; status?: string };
type Review = { senderAddress?: string; resume?: Resume; previews: Preview[]; skipped?: { contactId?: string; reason?: string }[] };
type ImportResult = { valid: number; duplicate: number; invalid: number; suppressed: number; errors?: { row?: number; message?: string }[] };
const tabs: { id: Tab; label: string }[] = [{id:"overview",label:"Overview"},{id:"materials",label:"Templates & résumés"},{id:"contacts",label:"Contacts"},{id:"compose",label:"New campaign"},{id:"campaigns",label:"Campaigns"}];
const gmailConnectionErrors: Record<string, string> = {
  invalid_state: "This Gmail connection attempt expired or was already used. Click Connect Gmail to start a new one.",
  denied: "Gmail sending permission was not granted. Click Connect Gmail if you want to try again.",
  missing_code: "Google did not finish the Gmail connection. Please start a new attempt.",
  authorization_incomplete: "Google did not provide the offline access needed to send queued messages. Please try connecting again.",
  account_mismatch: "Choose the same Google account you used to sign in to HireHello.",
  missing_send_permission: "Allow the Gmail sending permission to connect your mailbox.",
};

function statusTone(status?: string) {
  if (["accepted","sent","completed","connected"].includes(status || "")) return "good";
  if (["failed","revoked","disconnected","needs_attention"].includes(status || "")) return "bad";
  return "warn";
}
function friendlyStatus(status?: string) {
  if (status === "accepted" || status === "sent") return "Accepted by Gmail";
  return (status || "Pending").replaceAll("_", " ");
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [connection, setConnection] = useState<Connection>({ connected: false });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [templateForm, setTemplateForm] = useState({ id: "", name: "", subject: "", bodyText: "" });
  const [resumeLabel, setResumeLabel] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [contactForm, setContactForm] = useState({ id: "", recruiterName: "", email: "", companyName: "" });
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [campaignForm, setCampaignForm] = useState({ name: "", templateId: "", resumeId: "" });
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const csvInput = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (status === "unauthenticated") router.replace("/signin"); }, [status, router]);
  useEffect(() => {
    const gmail = new URLSearchParams(window.location.search).get("gmail");
    if (gmail === "connected") setFeedback({ error: false, message: "Gmail connected. Your mailbox is ready for reviewed campaigns." });
    else if (gmail && gmail !== "connected") setFeedback({ error: true, message: gmailConnectionErrors[gmail] || "Gmail connection could not be completed. Please try again." });
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [g, t, r, c, campaignsResult] = await Promise.all([
        api<Connection>("/api/gmail/connection"),
        api<{ templates: Template[] }>("/api/templates"),
        api<{ resumes: Resume[] }>("/api/resumes"),
        api<{ contacts: Contact[] }>("/api/contacts"),
        api<{ campaigns: Campaign[] }>("/api/campaigns")
      ]);
      setConnection(g); setTemplates(t.templates || []); setResumes(r.resumes || []); setContacts(c.contacts || []); setCampaigns(campaignsResult.campaigns || []);
    } catch (error) { setFeedback({ error: true, message: error instanceof Error ? error.message : "Could not load your workspace." }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { if (status === "authenticated") void refresh(); }, [status, refresh]);
  const refreshCampaign = useCallback(async (id: string) => {
    try {
      const data = await api<{ campaign: Campaign; deliveries: Delivery[] }>(`/api/campaigns/${encodeURIComponent(id)}`);
      setSelectedCampaign(data.campaign); setDeliveries(data.deliveries || []);
    } catch (error) { setFeedback({ error: true, message: error instanceof Error ? error.message : "Could not load campaign." }); }
  }, []);
  useEffect(() => {
    if (!selectedCampaign?.id || !["queued", "running", "sending", "active"].includes(selectedCampaign.status)) return;
    const interval = window.setInterval(() => { void refreshCampaign(selectedCampaign.id); void api<{ campaigns: Campaign[] }>("/api/campaigns").then(data => setCampaigns(data.campaigns || [])).catch(() => {}); }, 5000);
    return () => window.clearInterval(interval);
  }, [selectedCampaign?.id, selectedCampaign?.status, refreshCampaign]);

  async function run(task: () => Promise<void>, success?: string) {
    setBusy(true); setFeedback(null);
    try { await task(); if (success) setFeedback({ error: false, message: success }); }
    catch (error) { setFeedback({ error: true, message: error instanceof Error ? error.message : "Something went wrong. Please try again." }); }
    finally { setBusy(false); }
  }
  async function saveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const { id, ...body } = templateForm;
      await api(id ? `/api/templates/${encodeURIComponent(id)}` : "/api/templates", json(id ? "PATCH" : "POST", body));
      setTemplateForm({ id:"",name:"",subject:"",bodyText:"" }); await refresh();
    }, "Template saved.");
  }
  async function uploadResume(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!resumeFile) return;
    await run(async () => {
      const data = new FormData(); data.append("file", resumeFile); data.append("label", resumeLabel.trim() || resumeFile.name);
      await api("/api/resumes", { method:"POST", body:data });
      setResumeFile(null); setResumeLabel(""); if (resumeInput.current) resumeInput.current.value = ""; await refresh();
    }, "Résumé uploaded.");
  }
  async function addContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const { id, ...body } = contactForm;
      await api(id ? `/api/contacts/${encodeURIComponent(id)}` : "/api/contacts", json(id ? "PATCH" : "POST", body));
      setContactForm({ id:"",recruiterName:"",email:"",companyName:"" }); await refresh();
    }, contactForm.id ? "Contact updated." : "Contact added.");
  }
  async function importCsv(file: File) {
    await run(async () => {
      const data = new FormData(); data.append("file", file);
      const result = await api<ImportResult>("/api/contacts/import", { method:"POST", body:data });
      setImportResult(result); await refresh();
      if (csvInput.current) csvInput.current.value = "";
    }, "CSV import finished.");
  }
  async function previewCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const data = await api<Review>("/api/campaigns/preview", json("POST", { ...campaignForm, contactIds:selectedContacts }));
      setReview(data); setIdempotencyKey(newIdempotencyKey());
    });
  }
  async function sendTest() {
    if (!review?.previews.length || !connection.connected) return;
    const firstContact = contacts.find(c => c.id === (review.previews[0] as Preview & {contactId?: string}).contactId);
    await run(async () => {
      await api("/api/campaigns/test", json("POST", {
        templateId: campaignForm.templateId,
        resumeId: campaignForm.resumeId,
        recruiterName: firstContact?.recruiterName || session?.user?.name || "Recruiter",
        companyName: firstContact?.companyName || "Example Company"
      }, { "Idempotency-Key": newIdempotencyKey() }));
    }, `Test message accepted by Gmail for ${connection.email || "your own mailbox"}.`);
  }
  async function createCampaign() {
    if (!review || !connection.connected) return;
    const count = review.previews.length;
    if (!window.confirm(`Send ${count} individual email${count === 1 ? "" : "s"} from ${review.senderAddress || connection.email || "your connected Gmail account"}?`)) return;
    await run(async () => {
      const data = await api<{ campaign: Campaign }>("/api/campaigns", json("POST", { ...campaignForm, contactIds:selectedContacts }, { "Idempotency-Key":idempotencyKey }));
      setReview(null); setCampaignForm({ name:"",templateId:"",resumeId:"" }); setSelectedContacts([]);
      await refresh(); await refreshCampaign(data.campaign.id); setTab("campaigns");
    }, "Campaign queued. Individual send results will appear below.");
  }
  function updateCampaignForm(change: Partial<typeof campaignForm>) { setCampaignForm(prev => ({...prev,...change})); setReview(null); }
  function toggleContact(id: string) { setSelectedContacts(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev,id]); setReview(null); }
  const availableContacts = contacts.filter(c => (c.status || "active") === "active");
  const accepted = campaigns.reduce((sum,c) => sum + (c.totals?.accepted || c.totals?.sent || 0),0);
  const failed = campaigns.reduce((sum,c) => sum + (c.totals?.failed || 0),0);
  function exportResults() {
    if (!selectedCampaign) return;
    const rows = [["email","status","errorCode","gmailMessageId"], ...deliveries.map(d => [d.to,d.status,d.errorCode || "",String((d as Delivery & { gmailMessageId?: string }).gmailMessageId || "")])];
    const csv = rows.map(row => row.map(cell => `"${cell.replaceAll('"','""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const link = document.createElement("a"); link.href = url; link.download = `hirehello-${selectedCampaign.id}.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (status === "loading" || loading) return <main className="auth-shell"><div className="brand">HireHello<span className="brand-dot">.</span></div><p className="muted" role="status">Loading your workspace…</p></main>;
  if (status !== "authenticated") return null;
  return <div className="app-shell">
    <header className="app-header"><div className="app-header-inner"><a href="/dashboard" className="brand">HireHello<span className="brand-dot">.</span></a><div className="app-header-actions"><span className="email-label">{session?.user?.email}</span><button className="button-plain" type="button" onClick={() => void signOut({callbackUrl:"/"})}>Sign out</button></div></div></header>
    <main className="app-main">
      <div className="eyebrow">Your outreach workspace</div><h1 className="page-title">Hello, {session?.user?.name?.split(" ")[0] || "there"}.</h1><p className="muted">Prepare thoughtful, individual introductions from your Gmail account.</p>
      {feedback && <div role={feedback.error ? "alert" : "status"} className={`alert ${feedback.error ? "error" : ""}`}>{feedback.message}</div>}
      <nav className="nav-tabs" aria-label="Workspace sections">{tabs.map(item => <button key={item.id} type="button" className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); setFeedback(null); }}>{item.label}</button>)}</nav>

      {tab === "overview" && <div className="stack">
        <div className="grid-3"><div className="card"><div className="stat-value">{campaigns.length}</div><div className="muted">Campaigns</div></div><div className="card"><div className="stat-value">{accepted}</div><div className="muted">Accepted by Gmail</div></div><div className="card"><div className="stat-value">{failed}</div><div className="muted">Failed sends</div></div></div>
        <section className="card"><div className="section-heading"><div><h2>Gmail connection</h2><p className="muted small">Sign-in and sending permission are separate.</p></div><span className={`tag ${connection.connected ? "good" : "warn"}`}>{connection.connected ? "Connected" : "Not connected"}</span></div>
          {connection.connected ? <><p>Messages will be sent from <strong>{connection.email || session?.user?.email}</strong>.</p><div className="row"><button type="button" className="button button-danger button-small" disabled={busy} onClick={() => void run(async () => { await api("/api/gmail/connection", {method:"DELETE"}); await refresh(); }, "Gmail disconnected.")}>Disconnect Gmail</button></div></> : <><p className="muted">{connection.status === "reconnect_required" ? "Google needs you to reconnect before queued emails can continue." : "Connect Gmail when you are ready to preview and send. Google will ask you to allow sending on your behalf."}</p><a className="button" href="/api/gmail/connect">{connection.status === "reconnect_required" ? "Reconnect Gmail" : "Connect Gmail"}</a></>}
        </section>
        <section className="card"><div className="section-heading"><div><h2>Get started</h2><p className="muted small">Add your materials and contacts, then review a campaign.</p></div><button className="button button-small" onClick={() => setTab("compose")}>New campaign</button></div><div className="grid-3"><div><strong>{templates.length} templates</strong><p className="muted small">A subject and plain-text message with merge fields.</p><button className="button-plain" onClick={() => setTab("materials")}>Manage templates →</button></div><div><strong>{resumes.length} résumés</strong><p className="muted small">Private PDFs, selected per campaign.</p><button className="button-plain" onClick={() => setTab("materials")}>Manage résumés →</button></div><div><strong>{contacts.length} contacts</strong><p className="muted small">Recruiters and hiring managers you choose.</p><button className="button-plain" onClick={() => setTab("contacts")}>Manage contacts →</button></div></div></section>
        <div className="notice">“Accepted by Gmail” means Gmail accepted the send request. It does not confirm inbox delivery or that someone read the email.</div>
      </div>}

      {tab === "materials" && <div className="grid-2">
        <section className="card"><div className="section-heading"><div><h2>Email templates</h2><p className="muted small">Allowed placeholders: recruiterName, companyName, senderName.</p></div></div>
          <form className="stack" onSubmit={saveTemplate}><div className="field"><label htmlFor="template-name">Template name</label><input id="template-name" required maxLength={100} value={templateForm.name} onChange={e => setTemplateForm({...templateForm,name:e.target.value})} placeholder="Software engineering introduction" /></div><div className="field"><label htmlFor="template-subject">Subject</label><input id="template-subject" required maxLength={200} value={templateForm.subject} onChange={e => setTemplateForm({...templateForm,subject:e.target.value})} placeholder="Exploring roles at {{companyName}}" /></div><div className="field"><label htmlFor="template-body">Email body</label><textarea id="template-body" required value={templateForm.bodyText} onChange={e => setTemplateForm({...templateForm,bodyText:e.target.value})} placeholder={"Hi {{recruiterName}},\n\nI’m interested in opportunities at {{companyName}}…\n\nThanks,\n{{senderName}}"}/></div><div className="row"><button className="button" disabled={busy}>{templateForm.id ? "Save changes" : "Save template"}</button>{templateForm.id && <button type="button" className="button button-secondary" onClick={() => setTemplateForm({id:"",name:"",subject:"",bodyText:""})}>Cancel edit</button>}</div></form>
          <hr className="divider"/><div className="list">{templates.length ? templates.map(t => <div className="list-item" key={t.id}><div><strong>{t.name}</strong><p>{t.subject}</p></div><div className="row"><button type="button" className="button-plain" onClick={() => setTemplateForm({id:t.id,name:t.name,subject:t.subject,bodyText:t.bodyText})}>Edit</button><button type="button" className="button-plain" disabled={busy} onClick={() => { if (window.confirm(`Delete template “${t.name}”?`)) void run(async () => { await api(`/api/templates/${encodeURIComponent(t.id)}`, {method:"DELETE"}); await refresh(); }, "Template deleted."); }}>Delete</button></div></div>) : <div className="empty">No templates yet. Save one to get started.</div>}</div>
        </section>
        <section className="card"><div className="section-heading"><div><h2>Résumés</h2><p className="muted small">PDF only, up to 10 MB.</p></div></div><form className="stack" onSubmit={uploadResume}><div className="field"><label htmlFor="resume-label">Label</label><input id="resume-label" required maxLength={100} value={resumeLabel} onChange={e => setResumeLabel(e.target.value)} placeholder="Backend engineer · 2026" /></div><div className="field"><label htmlFor="resume-file">PDF file</label><input ref={resumeInput} className="file-input" id="resume-file" type="file" accept="application/pdf,.pdf" required onChange={e => setResumeFile(e.target.files?.[0] || null)}/></div><button className="button" disabled={busy || !resumeFile}>Upload résumé</button></form><hr className="divider"/><div className="list">{resumes.length ? resumes.map(r => <div className="list-item" key={r.id}><div><strong>{r.label}</strong><p>{r.filename || "PDF"}{r.size ? ` · ${(r.size/1024/1024).toFixed(1)} MB` : ""}</p></div><button type="button" className="button-plain" disabled={busy} onClick={() => { if (window.confirm(`Delete résumé “${r.label}”?`)) void run(async () => { await api(`/api/resumes/${encodeURIComponent(r.id)}`, {method:"DELETE"}); await refresh(); }, "Résumé deleted."); }}>Delete</button></div>) : <div className="empty">No résumés yet. Upload a PDF to attach to your messages.</div>}</div></section>
      </div>}

      {tab === "contacts" && <div className="stack"><div className="grid-2"><section className="card"><h2>{contactForm.id ? "Edit contact" : "Add a contact"}</h2><form className="stack" onSubmit={addContact}><div className="field"><label htmlFor="contact-name">Recruiter name</label><input id="contact-name" required value={contactForm.recruiterName} onChange={e => setContactForm({...contactForm,recruiterName:e.target.value})}/></div><div className="field"><label htmlFor="contact-email">Email address</label><input id="contact-email" type="email" required value={contactForm.email} onChange={e => setContactForm({...contactForm,email:e.target.value})}/></div><div className="field"><label htmlFor="contact-company">Company</label><input id="contact-company" required value={contactForm.companyName} onChange={e => setContactForm({...contactForm,companyName:e.target.value})}/></div><div className="row"><button className="button" disabled={busy}>{contactForm.id ? "Save contact" : "Add contact"}</button>{contactForm.id && <button className="button button-secondary" type="button" onClick={()=>setContactForm({id:"",recruiterName:"",email:"",companyName:""})}>Cancel edit</button>}</div></form></section><section className="card"><h2>Import a CSV</h2><p className="muted">Use columns <code>email,recruiterName,companyName</code>. Invalid, duplicate, and suppressed rows are skipped.</p><div className="field"><label htmlFor="contacts-csv">Choose CSV file</label><input ref={csvInput} className="file-input" id="contacts-csv" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void importCsv(file); }}/></div>{importResult && <div className="alert" role="status">{importResult.valid} added · {importResult.duplicate} duplicates · {importResult.invalid} invalid · {importResult.suppressed} suppressed{importResult.errors?.length ? <ul>{importResult.errors.slice(0,5).map((item,index)=><li key={index}>Row {item.row}: {item.message}</li>)}</ul> : null}</div>}</section></div>
        <section className="card"><div className="section-heading"><h2>Your contacts ({contacts.length})</h2></div>{contacts.length ? <div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Status</th><th>Action</th></tr></thead><tbody>{contacts.map(c => <tr key={c.id}><td>{c.recruiterName}</td><td>{c.email || c.emailNormalized}</td><td>{c.companyName}</td><td><span className={`tag ${c.status === "suppressed" ? "bad" : "good"}`}>{c.status || "active"}</span></td><td><div className="row"><button type="button" className="button-plain" disabled={c.status === "suppressed"} onClick={()=>setContactForm({id:c.id,recruiterName:c.recruiterName,email:c.email || c.emailNormalized || "",companyName:c.companyName})}>Edit</button>{c.status !== "suppressed" && <button type="button" className="button-plain" disabled={busy} onClick={()=>{if(window.confirm(`Block future sends to ${c.email || c.emailNormalized}?`)) void run(async()=>{await api(`/api/contacts/${encodeURIComponent(c.id)}/suppress`,{method:"POST"});setSelectedContacts(prev=>prev.filter(id=>id!==c.id));await refresh();},"Contact suppressed from future sends.");}}>Suppress</button>}<button type="button" className="button-plain" disabled={busy} onClick={() => { if (window.confirm(`Remove ${c.recruiterName} from contacts?`)) void run(async () => { await api(`/api/contacts/${encodeURIComponent(c.id)}`, {method:"DELETE"}); setSelectedContacts(prev=>prev.filter(id=>id!==c.id)); await refresh(); }, "Contact removed."); }}>Remove</button></div></td></tr>)}</tbody></table></div> : <div className="empty">No contacts yet. Add people you have a reason to approach.</div>}</section></div>}

      {tab === "compose" && <div className="grid-2"><section className="card"><h2>New campaign</h2><p className="muted small">Select your material and recipients, then preview the exact message for each person.</p><form className="stack" onSubmit={previewCampaign}><div className="field"><label htmlFor="campaign-name">Campaign name</label><input id="campaign-name" required maxLength={100} value={campaignForm.name} onChange={e=>updateCampaignForm({name:e.target.value})} placeholder="Backend roles · October" /></div><div className="field"><label htmlFor="campaign-template">Email template</label><select id="campaign-template" required value={campaignForm.templateId} onChange={e=>updateCampaignForm({templateId:e.target.value})}><option value="">Choose a template</option>{templates.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></div><div className="field"><label htmlFor="campaign-resume">Résumé attachment</label><select id="campaign-resume" required value={campaignForm.resumeId} onChange={e=>updateCampaignForm({resumeId:e.target.value})}><option value="">Choose a résumé</option>{resumes.map(r=><option value={r.id} key={r.id}>{r.label}</option>)}</select></div><div className="field"><label>Recipients ({selectedContacts.length} selected, up to 20)</label><div className="check-list" role="group" aria-label="Select recipients">{availableContacts.length ? availableContacts.map(c=><label className="check-row" key={c.id}><input type="checkbox" checked={selectedContacts.includes(c.id)} onChange={()=>toggleContact(c.id)}/><span>{c.recruiterName} · {c.companyName} <span className="muted small">({c.email || c.emailNormalized})</span></span></label>) : <div className="empty">Add active contacts before creating a campaign.</div>}</div></div><div className="row"><button type="button" className="button-plain" onClick={()=>{setSelectedContacts(availableContacts.slice(0,20).map(c=>c.id));setReview(null);}}>{availableContacts.length > 20 ? "Select first 20" : "Select all active"}</button><button type="button" className="button-plain" onClick={()=>{setSelectedContacts([]);setReview(null);}}>Clear</button></div><button className="button" disabled={busy || selectedContacts.length === 0 || selectedContacts.length > 20 || !campaignForm.templateId || !campaignForm.resumeId}>Preview every message</button></form></section>
        <section className="card"><h2>Review before sending</h2>{review ? <><p className="muted small">From <strong>{review.senderAddress || connection.email || "your Gmail account"}</strong> · {review.previews.length} individual message{review.previews.length===1?"":"s"} · {review.resume?.label || resumes.find(r=>r.id===campaignForm.resumeId)?.label}</p>{review.skipped?.length ? <div className="alert error">{review.skipped.length} contact{review.skipped.length===1?"":"s"} skipped. Those contacts will not receive an email.<ul>{review.skipped.map((item,index)=><li key={`${item.contactId}-${index}`}>{contacts.find(c=>c.id===item.contactId)?.email || item.contactId}: {(item.reason || "excluded").replaceAll("_"," ")}</li>)}</ul></div> : null}<div style={{maxHeight:500,overflowY:"auto"}}>{review.previews.map((p,index)=><article className="preview" key={`${p.to}-${index}`}><div><strong>To:</strong> {contacts.find(c=>c.id === (p as Preview & {contactId?: string}).contactId)?.recruiterName ? `${contacts.find(c=>c.id === (p as Preview & {contactId?: string}).contactId)?.recruiterName} <${p.to}>` : p.to}</div><div><strong>Subject:</strong> {p.subject}</div><pre>{p.bodyText || p.body}</pre></article>)}</div>{!connection.connected && <div className="alert error">Connect Gmail before sending. Your preview is ready.</div>}<button type="button" className="button button-secondary full" disabled={busy || !connection.connected || !review.previews.length} onClick={()=>void sendTest()}>Send test to myself</button><p className="small muted">Sends one real email with the selected PDF to your own connected mailbox, using the first previewed contact’s name and company.</p><div className="spacer"/><button type="button" className="button full" disabled={busy || !connection.connected || !review.previews.length} onClick={()=>void createCampaign()}>Confirm and send {review.previews.length} individual email{review.previews.length===1?"":"s"}</button><p className="small muted">You will confirm once more before the campaign is queued. Sending continues after you close this page.</p></> : <div className="empty">Your personalized emails will appear here. Nothing is sent during preview.</div>}</section></div>}

      {tab === "campaigns" && <div className="grid-2"><section className="card"><div className="section-heading"><h2>Campaigns</h2><button type="button" className="button button-small" onClick={()=>setTab("compose")}>New campaign</button></div><div className="list">{campaigns.length ? campaigns.map(c=><button type="button" className="list-item" style={{textAlign:"left",width:"100%",cursor:"pointer"}} key={c.id} onClick={()=>void refreshCampaign(c.id)}><div><strong>{c.name}</strong><p>{c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}</p></div><span className={`tag ${statusTone(c.status)}`}>{friendlyStatus(c.status)}</span></button>) : <div className="empty">Your campaigns will appear here after you confirm a send.</div>}</div></section><section className="card"><h2>Campaign results</h2>{selectedCampaign ? <><div className="row-between"><div><strong>{selectedCampaign.name}</strong><p className="muted small">From {selectedCampaign.senderAddress || connection.email || "your Gmail account"}</p></div><span className={`tag ${statusTone(selectedCampaign.status)}`}>{friendlyStatus(selectedCampaign.status)}</span></div><div className="row small muted"><span>{selectedCampaign.totals?.accepted || selectedCampaign.totals?.sent || 0} accepted</span><span>·</span><span>{selectedCampaign.totals?.failed || 0} failed</span><span>·</span><span>{selectedCampaign.totals?.queued || 0} queued</span></div>{["queued","running","sending","active"].includes(selectedCampaign.status) && <button type="button" className="button button-secondary button-small" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}/pause`, {method:"POST"});await refreshCampaign(selectedCampaign.id);await refresh();},"Remaining queued emails paused.")}>Pause remaining emails</button>}{selectedCampaign.status === "paused" && <button type="button" className="button button-secondary button-small" disabled={busy || !connection.connected} onClick={()=>void run(async()=>{await api(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}/resume`,{method:"POST"});await refreshCampaign(selectedCampaign.id);await refresh();},"Campaign resumed.")}>Resume campaign</button>}<button type="button" className="button button-secondary button-small" onClick={exportResults}>Export CSV</button><div className="spacer"/><div className="list">{deliveries.map(d=><div className="list-item" key={d.id}><div><strong>{d.recruiterName || d.to}</strong><p>{d.to}{d.companyName ? ` · ${d.companyName}` : ""}</p>{d.errorCode && <p role="alert">{d.errorMessage || d.errorCode}</p>}</div><div className="row"><span className={`tag ${statusTone(d.status)}`}>{friendlyStatus(d.status)}</span>{d.status === "failed" && selectedCampaign.status !== "paused" && <button type="button" className="button-plain" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/deliveries/${encodeURIComponent(d.id)}/retry`,{method:"POST"});await refreshCampaign(selectedCampaign.id);await refresh();},"Failed send queued for retry.")}>Retry</button>}</div></div>)}</div><p className="small muted">Accepted means Gmail accepted the send request; delivery and reading are not confirmed. Uncertain sends need manual review.</p></> : <div className="empty">Choose a campaign to see individual results.</div>}</section></div>}
    </main>
  </div>;
}
