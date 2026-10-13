"use client";

import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, json, newIdempotencyKey, type Campaign, type Contact, type Delivery, type Preview, type Resume, type Template } from "@/app/components/hirehello/api";

import { Brand, EmptyState, Icon, type IconName } from "@/app/components/hirehello/ui";

import { ConfirmDialog, type Confirmation } from "@/app/components/hirehello/confirm-dialog";
import { ContactList } from "@/app/components/hirehello/contact-list";
import { MAX_RESUME_UPLOAD_BYTES } from "@/lib/core/resume-upload-limit";

import { useNotifications } from "@/app/components/hirehello/notifications";
import { EmailBody } from "@/app/components/hirehello/email-body";
import { EmailEditor } from "@/app/components/hirehello/email-editor";
import { campaignNotifications } from "@/lib/core/campaign-notifications";

type Tab = "overview" | "materials" | "contacts" | "compose" | "campaigns";
type Connection = { connected: boolean; email?: string; status?: string };
type Review = { previewToken: string; senderAddress?: string; resume?: Resume; previews: Preview[]; skipped?: { contactId?: string; reason?: string }[] };
type ImportResult = { valid: number; duplicate: number; invalid: number; suppressed: number; errors?: { row?: number; message?: string }[] };
const tabs: { id: Tab; label: string; icon: IconName; description: string }[] = [
  { id: "overview", label: "Overview", icon: "home", description: "A little preparation. A more personal hello." },
  { id: "materials", label: "My materials", icon: "layers", description: "Write it once. Make every introduction feel personal." },
  { id: "contacts", label: "Contacts", icon: "users", description: "Keep the people you want to reach in one place." },
  { id: "compose", label: "New campaign", icon: "send", description: "Choose your materials, pick your people, and review every email." },
  { id: "campaigns", label: "Campaigns", icon: "chart", description: "Follow every introduction from your queue to Gmail." },
];
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
  const notify = useNotifications();
  const campaignSnapshot = useRef<Campaign[] | null>(null);
  const pollingFailed = useRef(false);
  const initialLoad = useRef(true);
  const [tab, setActiveTab] = useState<Tab>("overview");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [recipientSearch, setRecipientSearch] = useState("");
  function setTab(next: Tab) {
    setActiveTab(next);
    window.scrollTo({ top: 0 });
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    url.searchParams.delete("gmail");
    window.history.replaceState(null, "", url);
  }
  const [connection, setConnection] = useState<Connection>({ connected: false });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [templateForm, setTemplateForm] = useState({ id: "", name: "", subject: "", bodyText: "" });
  const [resumeLabel, setResumeLabel] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [contactForm, setContactForm] = useState({ id: "", recruiterName: "", email: "", companyName: "" });
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [campaignForm, setCampaignForm] = useState({ name: "", templateId: "", resumeId: "", sendMode: "first_contact" as "first_contact" | "resend" });
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const testSendKey = useRef("");
  const csvInput = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (status === "unauthenticated") router.replace("/signin"); }, [status, router]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const activeTab = params.get("tab");
    if (tabs.some(item => item.id === activeTab)) setActiveTab(activeTab as Tab);
    const gmail = params.get("gmail");
    if (gmail === "connected") notify({ tone: "success", message: "Gmail connected. Your mailbox is ready for reviewed campaigns." });
    else if (gmail && gmail !== "connected") notify({ tone: "error", message: gmailConnectionErrors[gmail] || "Gmail connection could not be completed. Please try again." });
    if (gmail) { const url = new URL(window.location.href); url.searchParams.delete("gmail"); window.history.replaceState(null, "", url); }
  }, [notify]);

  const refresh = useCallback(async () => {
    const noticeId = initialLoad.current ? notify({ tone: "loading", message: "Loading your workspace…" }) : undefined;
    initialLoad.current = false;
    try {
      const [g, t, r, c, campaignsResult] = await Promise.all([
        api<Connection>("/api/gmail/connection"),
        api<{ templates: Template[] }>("/api/templates"),
        api<{ resumes: Resume[] }>("/api/resumes"),
        api<{ contacts: Contact[] }>("/api/contacts"),
        api<{ campaigns: Campaign[] }>("/api/campaigns")
      ]);
      campaignSnapshot.current = campaignsResult.campaigns || [];
      setReview(null); testSendKey.current = "";
      setConnection(g); setTemplates(t.templates || []); setResumes(r.resumes || []); setContacts(c.contacts || []); setCampaigns(campaignsResult.campaigns || []);
      if (noticeId) notify({ id: noticeId, tone: "success", message: "Your workspace is ready." });
    } catch (error) { notify({ id: noticeId || "workspace-refresh", tone: "error", message: `Could not refresh your workspace: ${error instanceof Error ? error.message : "Please reload to try again."}` }); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { if (status === "authenticated") void refresh(); }, [status, refresh]);
  const refreshCampaign = useCallback(async (id: string) => {
    try {
      const data = await api<{ campaign: Campaign; deliveries: Delivery[] }>(`/api/campaigns/${encodeURIComponent(id)}`);
      setSelectedCampaign(data.campaign); setDeliveries(data.deliveries || []);
    } catch (error) { notify({ tone: "error", message: error instanceof Error ? error.message : "Could not load campaign." }); }
  }, [notify]);
  const hasPendingOutreach = contacts.some(contact => contact.outreachStatus === "scheduled") || campaigns.some(campaign => ["queued", "running", "sending", "active"].includes(campaign.status));
  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    let inFlight = false;
    async function syncOutreach() {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      try {
        const [contactResult, campaignResult, gmail, detail] = await Promise.all([
          api<{ contacts: Contact[] }>("/api/contacts"), api<{ campaigns: Campaign[] }>("/api/campaigns"), api<Connection>("/api/gmail/connection"),
          selectedCampaign?.id ? api<{ campaign: Campaign; deliveries: Delivery[] }>(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}`) : Promise.resolve(null)
        ]);
        if (cancelled) return;
        for (const notice of campaignNotifications(campaignSnapshot.current, campaignResult.campaigns)) notify(notice);
        campaignSnapshot.current = campaignResult.campaigns;
        if (pollingFailed.current) { notify({ id: "background-sync", tone: "success", message: "Live updates reconnected." }); pollingFailed.current = false; }
        if (connection.connected && !gmail.connected) notify({ id: "gmail-connection", tone: "error", message: "Gmail needs reconnecting. Open Overview to restore sending." });
        setConnection(gmail); setContacts(contactResult.contacts); setCampaigns(campaignResult.campaigns);
        if (detail) { setSelectedCampaign(detail.campaign); setDeliveries(detail.deliveries || []); }
      } catch {
        if (!cancelled && !pollingFailed.current) { pollingFailed.current = true; notify({ id: "background-sync", tone: "error", message: "Live updates are temporarily unavailable. Retrying automatically; queued work may still continue." }); }
      } finally { inFlight = false; }
    }
    // A quiet poll also discovers work started in another tab. No toast is shown
    // for a successful poll unless an actual campaign/connection state changes.
    const interval = window.setInterval(() => void syncOutreach(), hasPendingOutreach ? 5000 : 30000);
    window.addEventListener("focus", syncOutreach);
    document.addEventListener("visibilitychange", syncOutreach);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener("focus", syncOutreach); document.removeEventListener("visibilitychange", syncOutreach); };
  }, [status, hasPendingOutreach, selectedCampaign?.id, notify, connection.connected]);
  useEffect(() => {
    const eligible = selectedContacts.filter(id => contacts.some(contact => contact.id === id && contact.outreachStatus === "ready"));
    if (eligible.length !== selectedContacts.length) { setSelectedContacts(eligible); setReview(null); }
  }, [contacts, selectedContacts]);

  function requestConfirmation(options: Omit<Confirmation, "action">, task: () => Promise<void>, success: string) {
    setConfirmation({ ...options, action: async () => {
      setBusy(true);
      const id = notify({ tone: "loading", message: `${options.label}…` });
      try { await task(); notify({ id, tone: "success", message: success }); }
      catch (error) { notify({ id, tone: "error", message: error instanceof Error ? error.message : "Something went wrong. Please try again." }); throw error; }
      finally { setBusy(false); }
    } });
  }

  async function run(task: () => Promise<void>, success = "Done.", pending = "Working on your request…") {
    setBusy(true);
    const id = notify({ tone: "loading", message: pending });
    try { await task(); notify({ id, tone: "success", message: success }); }
    catch (error) { notify({ id, tone: "error", message: error instanceof Error ? error.message : "Something went wrong. Please try again." }); }
    finally { setBusy(false); }
  }
  async function saveTemplate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const { id, ...body } = templateForm;
      await api(id ? `/api/templates/${encodeURIComponent(id)}` : "/api/templates", json(id ? "PATCH" : "POST", body));
      setTemplateForm({ id:"",name:"",subject:"",bodyText:"" }); await refresh();
    }, "Template saved.", "Saving your template…");
  }
  async function uploadResume(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!resumeFile) return;
    await run(async () => {
      const data = new FormData(); data.append("file", resumeFile); data.append("label", resumeLabel.trim() || resumeFile.name);
      await api("/api/resumes", { method:"POST", body:data });
      setResumeFile(null); setResumeLabel(""); if (resumeInput.current) resumeInput.current.value = ""; await refresh();
    }, "Résumé uploaded.", "Uploading your résumé…");
  }
  async function addContact(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const { id, ...body } = contactForm;
      await api(id ? `/api/contacts/${encodeURIComponent(id)}` : "/api/contacts", json(id ? "PATCH" : "POST", body));
      setContactForm({ id:"",recruiterName:"",email:"",companyName:"" }); await refresh();
    }, contactForm.id ? "Contact updated." : "Contact added.", "Saving your contact…");
  }
  async function importCsv(file: File) {
    setImportResult(null);
    if (file.size > 256_000 || !file.name.toLowerCase().endsWith(".csv")) {
      notify({tone:"error",message:"Choose a CSV file under 256 KB."});
      if (csvInput.current) csvInput.current.value = "";
      return;
    }
    await run(async () => {
      const data = new FormData(); data.append("file", file);
      const result = await api<ImportResult>("/api/contacts/import", { method:"POST", body:data });
      setImportResult(result); await refresh();
    }, "CSV import finished. Review the import summary for skipped rows.", "Importing contacts…");
    if (csvInput.current) csvInput.current.value = "";
  }
  async function previewCampaign(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      const data = await api<Review>("/api/campaigns/preview", json("POST", { ...campaignForm, contactIds:selectedContacts }));
      setReview(data); setIdempotencyKey(newIdempotencyKey()); testSendKey.current = newIdempotencyKey();
    }, "Preview ready. Review each message before sending.", "Preparing personalized previews…");
  }
  async function sendTest() {
    if (!review?.previews.length || !connection.connected) return;
    await run(async () => {
      await api("/api/campaigns/test", json("POST", {
        ...campaignForm, contactIds: selectedContacts, previewToken: review.previewToken
      }, { "Idempotency-Key": testSendKey.current }));
    }, `Test message accepted by Gmail for ${connection.email || "your own mailbox"}.`, "Sending your test email…");
  }
  function createCampaign() {
    if (!review || !connection.connected) return;
    const count = review.previews.length;
    requestConfirmation({ title: campaignForm.sendMode === "resend" ? "Send another email to these contacts?" : "Ready to make your introductions?", description: campaignForm.sendMode === "resend" ? "These people have already received an email accepted by Gmail. This sends a new, separate message with your selected résumé, not a reply in the original thread. Review the recipients and content before confirming." : "Each person gets a separate email with your selected résumé. Once queued, contacts leave your ready list automatically. Sending continues after you close this page.", label: `${campaignForm.sendMode === "resend" ? "Send again:" : "Send"} ${count} email${count === 1 ? "" : "s"}`, subject: `${count} ${campaignForm.sendMode === "resend" ? "repeat" : "individual"} email${count === 1 ? "" : "s"}`, detail: `From ${review.senderAddress || connection.email} · ${resumes.find(resume => resume.id === campaignForm.resumeId)?.label || "Selected résumé"}`, tone: "primary", icon: "send" }, async () => {
      const data = await api<{ campaign: Campaign }>("/api/campaigns", json("POST", { ...campaignForm, contactIds:selectedContacts, previewToken: review.previewToken }, { "Idempotency-Key":idempotencyKey }));
      setReview(null); setCampaignForm({ name:"",templateId:"",resumeId:"",sendMode:"first_contact" }); setSelectedContacts([]);
      await refresh(); await refreshCampaign(data.campaign.id); setTab("campaigns");
    }, "Campaign saved. Check its sending status and individual results below.");
  }
  function updateCampaignForm(change: Partial<typeof campaignForm>) { setCampaignForm(prev => ({...prev,...change})); setReview(null); }
  function changeSendMode(sendMode: "first_contact" | "resend") {
    updateCampaignForm({ sendMode }); setSelectedContacts([]); setRecipientSearch("");
  }
  function startResend(contact: Contact) {
    setCampaignForm(prev => ({ ...prev, sendMode: "resend", name: `Follow-up · ${contact.recruiterName}`.slice(0, 100), templateId: prev.templateId || (templates.length === 1 ? templates[0].id : ""), resumeId: prev.resumeId || (resumes.length === 1 ? resumes[0].id : "") }));
    setSelectedContacts([contact.id]); setRecipientSearch(""); setReview(null); setTab("compose");
    notify({ tone: "info", message: "Contact selected for a new email. Review your materials, then preview before sending." });
  }
  function toggleContact(id: string) { setSelectedContacts(prev => prev.includes(id) ? prev.filter(item => item !== id) : prev.length < 20 ? [...prev,id] : prev); setReview(null); }
  function useStarterTemplate() {
    notify({ tone: "info", message: "Starter template added to the editor. Make it yours, then save." });
    setTemplateForm({ id: "", name: "A friendly introduction", subject: "Exploring opportunities at {{companyName}}", bodyText: "Hi {{recruiterName}},\n\nI’m interested in opportunities at {{companyName}}. My background is in [your field], with experience in [a relevant skill or achievement].\n\nI’ve attached my résumé and would love to learn whether there’s a role where I could contribute. Would you be open to a short conversation?\n\nThank you for your time,\n{{senderName}}" });
  }
  const matchesContact = (c: Contact, query: string) => `${c.recruiterName} ${c.email || c.emailNormalized} ${c.companyName}`.toLowerCase().includes(query.trim().toLowerCase());
  const freshContacts = contacts.filter(c => c.outreachStatus === "ready");
  const contactedContacts = contacts.filter(c => c.outreachStatus === "contacted");
  const availableContacts = campaignForm.sendMode === "resend" ? contactedContacts : freshContacts;
  const visibleRecipients = availableContacts.filter(c => matchesContact(c, recipientSearch));
  const setupSteps: { label: string; detail: string; done: boolean; tab?: Tab; href?: string; icon: IconName }[] = [
    { label: "Connect your Gmail", detail: "Send from the account people can reply to.", done: connection.connected, href: "/api/gmail/connect", icon: "mail" },
    { label: "Save an email template", detail: "Start with a draft and add your own voice.", done: templates.length > 0, tab: "materials", icon: "layers" },
    { label: "Upload your résumé", detail: "A PDF, ready to attach to each introduction.", done: resumes.length > 0, tab: "materials", icon: "file" },
    { label: "Add your contacts", detail: "A name, company, and email for each person.", done: freshContacts.length + contactedContacts.length > 0, tab: "contacts", icon: "users" },
  ];
  const completedSteps = setupSteps.filter(step => step.done).length;
  const readyToCompose = completedSteps === setupSteps.length;
  const nextStep = setupSteps.find(step => !step.done);
  const currentPage = tabs.find(item => item.id === tab)!;
  const accepted = campaigns.reduce((sum,c) => sum + (c.totals?.accepted || c.totals?.sent || 0),0);
  const failed = campaigns.reduce((sum,c) => sum + (c.totals?.failed || 0),0);
  function exportResults() {
    if (!selectedCampaign) return;
    const rows = [["email","status","errorCode","gmailMessageId"], ...deliveries.map(d => [d.to,d.status,d.errorCode || "",String((d as Delivery & { gmailMessageId?: string }).gmailMessageId || "")])];
    const csv = rows.map(row => row.map(cell => `"${cell.replaceAll('"','""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const link = document.createElement("a"); link.href = url; link.download = `hirehello-${selectedCampaign.id}.csv`; link.click(); notify({ tone: "success", message: "CSV export prepared. Your browser will download the file." }); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (status === "loading" || loading) return <main className="auth-shell"><Brand /><span className="loading-ring" aria-hidden="true" /><p className="muted" role="status">Getting your workspace ready…</p></main>;
  if (status !== "authenticated") return null;
  return <div className="app-shell">
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    <aside className="sidebar">
      <a href="/dashboard" aria-label="HireHello home"><Brand /></a>
      <div className="sidebar-label">Your workspace</div>
      <nav className="nav-tabs" aria-label="Workspace sections">{tabs.map(item => <button key={item.id} type="button" title={item.label} className={tab === item.id ? "active" : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); }}><Icon name={item.icon} /><span>{item.label}</span>{item.id === "contacts" && contacts.length > 0 && <span className="nav-count">{contacts.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><Icon name="shield" /><strong>Your voice. Your inbox.</strong><p>Every message is reviewed by you and sent from your Gmail.</p></div><div className="sidebar-account"><span className="avatar">{session?.user?.name?.slice(0,1) || "H"}</span><div><strong>{session?.user?.name?.split(" ")[0] || "My account"}</strong><span>Personal workspace</span></div><button className="icon-button" title="Sign out" aria-label="Sign out" onClick={() => void run(async () => { await signOut({ redirect: false }); router.replace("/"); }, "Signed out.", "Signing out…")}><Icon name="logout" size={18} /></button></div></div>
    </aside>
    <div className="workspace">
    <header className="app-header"><div className="app-header-inner"><span className="breadcrumb">Workspace <span>/</span> <strong>{currentPage.label}</strong></span><span className={`connection-pill ${connection.connected ? "connected" : ""}`}><span className="status-dot" />{connection.connected ? "Gmail connected" : "Gmail not connected"}</span></div></header>
    <main className="app-main" id="workspace-content">
      <div className="page-heading"><div><div className="eyebrow">{tab === "overview" ? "Make your next move" : "Your outreach workspace"}</div><h1 className="page-title">{tab === "overview" ? `Hello, ${session?.user?.name?.split(" ")[0] || "there"}.` : currentPage.label}</h1><p className="muted">{currentPage.description}</p></div>{tab !== "compose" && <button className="button" onClick={() => setTab("compose")}><Icon name="plus" size={18} />New campaign</button>}</div>

      {tab === "overview" && <div className="stack overview-stack">
        <section className="welcome-banner"><div><span className="banner-label"><span className="status-dot" />A thoughtful hello goes a long way</span><h2>{readyToCompose ? "Your next opportunity starts here." : "Let’s get your first hello ready."}</h2><p>{readyToCompose ? "Your materials and contacts are ready. Bring them together in a personal introduction." : "Set up your essentials once. Then spend more time finding the right people."}</p>{nextStep?.href ? <a className="button button-light" href={nextStep.href}>{nextStep.label}<Icon name="arrow" size={18} /></a> : <button className="button button-light" onClick={() => setTab(nextStep?.tab || "compose")}>{nextStep?.label || "Create a campaign"}<Icon name="arrow" size={18} /></button>}</div><div className="banner-art" aria-hidden="true"><div className="letter-card"><span className="letter-stamp"><Icon name="mail" size={26} /></span><span className="letter-greeting">Hello, opportunity.</span><span className="letter-line"/><span className="letter-line short"/><div className="letter-footer"><span className="mini-avatar">You</span><span>A personal introduction</span><Icon name="check" size={16}/></div></div><span className="art-spark spark-one">✳</span><span className="art-spark spark-two">+</span></div></section>
        <div className="grid-3 stats-grid"><div className="card stat-card"><span className="stat-icon"><Icon name="send" /></span><div><span className="stat-label">Total campaigns</span><div className="stat-value">{campaigns.length}<span>campaigns created</span></div></div></div><div className="card stat-card"><span className="stat-icon mint"><Icon name="check" /></span><div><span className="stat-label">Accepted by Gmail</span><div className="stat-value">{accepted}<span>send requests accepted</span></div></div></div><div className="card stat-card"><span className="stat-icon peach"><Icon name="clock" /></span><div><span className="stat-label">Needs attention</span><div className="stat-value">{failed}<span>failed sends</span></div></div></div></div>
        <div className="overview-grid"><section className="card setup-card"><div className="section-heading"><div><h2>Your launch checklist</h2><p className="muted small">Four small steps to your first campaign.</p></div><span className="step-count">{completedSteps} / 4 ready</span></div><div className="setup-progress" role="progressbar" aria-label="Workspace setup" aria-valuemin={0} aria-valuemax={4} aria-valuenow={completedSteps}><span style={{width:`${completedSteps * 25}%`}} /></div><div className="setup-list">{setupSteps.map((step,index)=><div className={`setup-item ${step.done ? "done" : ""}`} key={step.label}><span className="step-number">{step.done ? <Icon name="check" size={17} /> : String(index + 1).padStart(2,"0")}</span><div><strong>{step.label}</strong><p>{step.detail}</p></div>{step.done ? <span className="tag good">Ready</span> : step.href ? <a className="icon-button" href={step.href} aria-label={step.label}><Icon name="arrow" size={18}/></a> : <button className="icon-button" onClick={()=>setTab(step.tab!)} aria-label={step.label}><Icon name="arrow" size={18}/></button>}</div>)}</div></section>
        <section className="card gmail-card"><span className="gmail-mark"><Icon name="mail" size={27}/></span><span className={`tag ${connection.connected ? "good" : "warn"}`}>{connection.connected ? "Connected" : "Not connected"}</span><h2>Your sending account</h2><p className="muted small">A familiar sender. A real conversation.</p><div className="account-address">{connection.email || session?.user?.email}</div><p className="muted small">{connection.connected ? "Your introductions will be sent individually from this account. Replies come straight to your Gmail inbox." : "Connect Gmail to send your reviewed messages. You choose when each campaign starts."}</p>{connection.connected ? <details className="account-settings"><summary>Connection settings</summary><p className="small muted">Disconnecting pauses queued campaigns until you reconnect.</p><button className="button button-danger button-small" disabled={busy} onClick={() => requestConfirmation({ title: "Disconnect your Gmail?", description: "Queued campaigns will pause until you reconnect. Emails already sent and your campaign history will stay available.", label: "Disconnect Gmail", subject: connection.email, icon: "mail" }, async () => { await api("/api/gmail/connection", {method:"DELETE"}); await refresh(); }, "Gmail disconnected.")}>Disconnect Gmail</button></details> : <a className="button full" href="/api/gmail/connect">{connection.status === "reconnect_required" ? "Reconnect Gmail" : "Connect Gmail"}<Icon name="arrow" size={17}/></a>}</section></div>
        <section className="card"><div className="section-heading"><div><h2>Recent campaigns</h2><p className="muted small">Every introduction, in one place.</p></div>{campaigns.length > 0 && <button className="button-plain" onClick={()=>setTab("campaigns")}>View all <Icon name="arrow" size={16}/></button>}</div>{campaigns.length ? <div className="list">{campaigns.slice(0,3).map(c=><button className="list-item campaign-row" key={c.id} onClick={()=>{setTab("campaigns");void refreshCampaign(c.id);}}><span className="stat-icon"><Icon name="send"/></span><div><strong>{c.name}</strong><p>{c.createdAt ? new Date(c.createdAt).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) : "Campaign"}</p></div><span className={`tag ${statusTone(c.status)}`}>{friendlyStatus(c.status)}</span><Icon name="arrow" size={18}/></button>)}</div> : <EmptyState icon="send" title="Your first campaign is ahead of you">Once you’ve saved your essentials, create a campaign to start making connections.</EmptyState>}</section>
        <p className="footnote"><Icon name="shield" size={15}/>Gmail acceptance confirms a send request, not inbox delivery or whether an email was read.</p>
      </div>}

      {tab === "materials" && <div className="grid-2">
        <section className="card"><div className="section-heading"><div><h2>Email templates</h2><p className="muted small">Your reusable message, personalized for each person.</p></div></div>
          {!templateForm.id && !templateForm.bodyText && <div className="starter-prompt"><span><Icon name="mail" size={18}/>Need a starting point?</span><button type="button" className="button-plain" onClick={useStarterTemplate}>Use starter template <Icon name="arrow" size={15}/></button></div>}
          <form className="stack" onSubmit={saveTemplate}><div className="field"><label htmlFor="template-name">Template name</label><input id="template-name" required maxLength={80} value={templateForm.name} onChange={e => setTemplateForm({...templateForm,name:e.target.value})} placeholder="Software engineering introduction" /></div><div className="field"><label htmlFor="template-subject">Subject</label><input id="template-subject" required maxLength={180} value={templateForm.subject} onChange={e => setTemplateForm({...templateForm,subject:e.target.value})} placeholder="Exploring roles at {{companyName}}" /></div><EmailEditor value={templateForm.bodyText} onChange={bodyText => setTemplateForm(prev => ({...prev, bodyText}))} senderName={session?.user?.name || "Your name"} /><div className="row"><button className="button" disabled={busy}>{templateForm.id ? "Save changes" : "Save template"}</button>{(templateForm.id || templateForm.name || templateForm.subject || templateForm.bodyText) && <button type="button" className="button button-secondary" onClick={() => setTemplateForm({id:"",name:"",subject:"",bodyText:""})}>{templateForm.id ? "Cancel edit" : "Clear draft"}</button>}</div></form>
          <hr className="divider"/><div className="list">{templates.length ? templates.map(t => <div className="list-item" key={t.id}><div><strong>{t.name}</strong><p>{t.subject}</p></div><div className="row"><button type="button" className="button-plain" onClick={() => setTemplateForm({id:t.id,name:t.name,subject:t.subject,bodyText:t.bodyText})}>Edit</button><button type="button" className="button-plain" disabled={busy} onClick={() => requestConfirmation({ title: "Delete this template?", description: "This removes the template from your materials. Existing campaigns keep their saved email content. This action cannot be undone.", label: "Delete template", subject: t.name, icon: "layers" }, async () => { await api(`/api/templates/${encodeURIComponent(t.id)}`, {method:"DELETE"}); if (templateForm.id === t.id) setTemplateForm({id:"",name:"",subject:"",bodyText:""}); await refresh(); }, "Template deleted.")}>Delete</button></div></div>) : <div className="empty">Your saved templates will live here. Start with a draft above.</div>}</div>
        </section>
        <section className="card"><div className="section-heading"><div><h2>Résumés</h2><p className="muted small">PDF only, up to 4 MB.</p></div></div><form className="stack" onSubmit={uploadResume}><div className="field"><label htmlFor="resume-label">Résumé name</label><input id="resume-label" required maxLength={100} value={resumeLabel} onChange={e => setResumeLabel(e.target.value)} placeholder="Backend engineer · 2026" /></div><div className="field"><label htmlFor="resume-file">PDF file</label><input ref={resumeInput} className="file-input" id="resume-file" type="file" accept="application/pdf,.pdf" required onChange={e => { const file = e.target.files?.[0] || null; if (file && (file.size > MAX_RESUME_UPLOAD_BYTES || !file.name.toLowerCase().endsWith(".pdf"))) { notify({tone:"error",message:"Choose a PDF résumé up to 4 MB."}); e.target.value = ""; setResumeFile(null); return; } setResumeFile(file); if (file && !resumeLabel) setResumeLabel(file.name.replace(/\.pdf$/i,"")); }}/></div><button className="button" disabled={busy || !resumeFile}>Upload résumé</button></form><hr className="divider"/><div className="list">{resumes.length ? resumes.map(r => <div className="list-item" key={r.id}><div><strong>{r.label}</strong><p>{r.filename || "PDF"}{r.size ? ` · ${(r.size/1024/1024).toFixed(1)} MB` : ""}</p></div><button type="button" className="button-plain" disabled={busy} onClick={() => requestConfirmation({ title: "Delete this résumé?", description: "This removes the PDF from your materials. Existing campaigns keep their saved attachment. This action cannot be undone.", label: "Delete résumé", subject: r.label, icon: "file" }, async () => { await api(`/api/resumes/${encodeURIComponent(r.id)}`, {method:"DELETE"}); await refresh(); }, "Résumé deleted.")}>Delete</button></div>) : <div className="empty">Upload a PDF once, then reuse it in any campaign.</div>}</div></section>
      </div>}

      {tab === "contacts" && <div className="stack"><div className="outreach-banner"><span className="stat-icon"><Icon name="check"/></span><div><strong>Your contact list takes care of itself.</strong><p>After Gmail accepts a send, the person moves to Contacted. Their history stays saved. Choose Send again when you want to contact them another time.</p></div><span className="tag good">Automatic</span></div><div className="grid-2"><section className="card"><h2>{contactForm.id ? "Edit contact" : "Add a contact"}</h2><form className="stack" onSubmit={addContact}><div className="field"><label htmlFor="contact-name">Recruiter name</label><input id="contact-name" required maxLength={120} value={contactForm.recruiterName} onChange={e => setContactForm({...contactForm,recruiterName:e.target.value})}/></div><div className="field"><label htmlFor="contact-email">Email address</label><input id="contact-email" type="email" required maxLength={254} value={contactForm.email} onChange={e => setContactForm({...contactForm,email:e.target.value})}/></div><div className="field"><label htmlFor="contact-company">Company</label><input id="contact-company" required maxLength={120} value={contactForm.companyName} onChange={e => setContactForm({...contactForm,companyName:e.target.value})}/></div><div className="row"><button className="button" disabled={busy}>{contactForm.id ? "Save contact" : "Add contact"}</button>{contactForm.id && <button className="button button-secondary" type="button" onClick={()=>setContactForm({id:"",recruiterName:"",email:"",companyName:""})}>Cancel edit</button>}</div></form></section><section className="card"><h2>Import a CSV</h2><p className="muted">Use columns <code>email,recruiterName,companyName</code>. Invalid, duplicate, and suppressed rows are skipped.</p><a className="button-plain csv-example" href="/contact-import-example.csv" download><Icon name="file" size={16}/>Download example CSV</a><div className="field"><label htmlFor="contacts-csv">Choose CSV file</label><input ref={csvInput} className="file-input" id="contacts-csv" type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const file = e.target.files?.[0]; if (file) void importCsv(file); }}/></div>{importResult && <div className="alert" role="status">{importResult.valid} added · {importResult.duplicate} duplicates · {importResult.invalid} invalid · {importResult.suppressed} suppressed{importResult.errors?.length ? <ul>{importResult.errors.slice(0,5).map((item,index)=><li key={index}>Row {item.row}: {item.message}</li>)}</ul> : null}</div>}</section></div>
        <ContactList onResend={startResend} contacts={contacts} busy={busy}
          onEdit={contact => { setContactForm({id:contact.id,recruiterName:contact.recruiterName,email:contact.email || contact.emailNormalized || "",companyName:contact.companyName}); document.getElementById("contact-name")?.focus(); }}
          onHistory={id => { setTab("campaigns"); void refreshCampaign(id); }}
          onBlock={contact => requestConfirmation({ title: "Block future emails?", description: "This address will be excluded from future sends, including queued emails that have not started sending. This block also applies if you import the address again.", label: "Block sends", subject: contact.recruiterName, detail: contact.email || contact.emailNormalized, icon: "shield" }, async () => { await api(`/api/contacts/${encodeURIComponent(contact.id)}/suppress`, {method:"POST"}); await refresh(); }, "Contact blocked from future sends.")}
          onRemove={contact => requestConfirmation({ title: "Remove this contact?", description: "This permanently removes the address-book entry. Campaign history is kept and queued emails are not cancelled. Contacted people already leave your ready list automatically, so no cleanup is needed after sending.", label: "Remove contact", subject: contact.recruiterName, detail: contact.email || contact.emailNormalized, icon: "users" }, async () => { await api(`/api/contacts/${encodeURIComponent(contact.id)}`, {method:"DELETE"}); if (contactForm.id === contact.id) setContactForm({id:"",recruiterName:"",email:"",companyName:""}); await refresh(); }, "Contact removed.")}
        /></div>}

      {tab === "compose" && <><div className="compose-steps"><span className="active"><b>1</b>Choose your essentials</span><Icon name="arrow" size={16}/><span className={review ? "active" : ""}><b>2</b>Review & send</span></div>{!readyToCompose && <div className="prerequisite-card"><div><strong>A few essentials before you send</strong><p className="muted small">Complete these to unlock your campaign preview.</p></div><div className="row">{setupSteps.filter(step=>!step.done).map(step=>step.href ? <a key={step.label} className="button button-secondary button-small" href={step.href}>{step.label}<Icon name="arrow" size={15}/></a> : <button key={step.label} className="button button-secondary button-small" onClick={()=>setTab(step.tab!)}>{step.label}<Icon name="arrow" size={15}/></button>)}</div></div>}<div className="grid-2 compose-grid"><section className="card"><div className="section-heading"><div><h2>Campaign details</h2><p className="muted small">Give this outreach a name you’ll recognize later.</p></div><span className="number-label">01</span></div><form className="stack" onSubmit={previewCampaign}><fieldset className="send-mode"><legend>Who would you like to email?</legend><label><input type="radio" name="send-mode" checked={campaignForm.sendMode === "first_contact"} onChange={() => changeSendMode("first_contact")}/><span><strong>First-time contacts <span className="count-badge">{freshContacts.length}</span></strong><small>People you haven’t emailed yet.</small></span></label><label><input type="radio" name="send-mode" checked={campaignForm.sendMode === "resend"} onChange={() => changeSendMode("resend")}/><span><strong>Send again <span className="count-badge">{contactedContacts.length}</span></strong><small>Choose previously contacted people.</small></span></label></fieldset>{campaignForm.sendMode === "resend" && <p className="resend-note">This sends a new email, not a reply. Previous messages stay in your history. Scheduled, blocked and uncertain sends are excluded.</p>}<div className="field"><label htmlFor="campaign-name">Campaign name</label><input id="campaign-name" required maxLength={100} value={campaignForm.name} onChange={e=>updateCampaignForm({name:e.target.value})} placeholder="Backend roles · October" /></div><div className="field"><label htmlFor="campaign-template">Email template</label><select id="campaign-template" required value={campaignForm.templateId} onChange={e=>updateCampaignForm({templateId:e.target.value})}><option value="">Choose a template</option>{templates.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select></div><div className="field"><label htmlFor="campaign-resume">Résumé attachment</label><select id="campaign-resume" required value={campaignForm.resumeId} onChange={e=>updateCampaignForm({resumeId:e.target.value})}><option value="">Choose a résumé</option>{resumes.map(r=><option value={r.id} key={r.id}>{r.label}</option>)}</select></div><div className="field"><label htmlFor="recipient-search">Recipients <span className="count-badge">{selectedContacts.length} / 20</span></label><div className="search-field"><Icon name="search" size={17}/><input id="recipient-search" placeholder="Find a person or company…" value={recipientSearch} onChange={e=>setRecipientSearch(e.target.value)}/></div><p className="small muted">{campaignForm.sendMode === "resend" ? "Previously contacted people available for another email." : "Only contacts ready for their first email are shown."}</p><div className="check-list" role="group" aria-label="Select recipients">{visibleRecipients.length ? visibleRecipients.map(c=><label className="check-row" key={c.id}><input type="checkbox" disabled={!selectedContacts.includes(c.id) && selectedContacts.length >= 20} checked={selectedContacts.includes(c.id)} onChange={()=>toggleContact(c.id)}/><span>{c.recruiterName} · {c.companyName} <span className="muted small">({c.email || c.emailNormalized})</span>{campaignForm.sendMode === "resend" && <span className="recipient-history">Previously contacted{c.contactedAt ? ` · ${new Date(c.contactedAt).toLocaleDateString()}` : ""}</span>}</span></label>) : <div className="empty">{availableContacts.length ? "No contacts match your search." : campaignForm.sendMode === "resend" ? "No contacted people are available for another email. Check Contacts for scheduled, blocked or uncertain sends." : "No first-time contacts left. Choose Send again above to see people you’ve already emailed, or add a new contact."}</div>}</div></div><div className="row"><button type="button" className="button-plain" onClick={()=>{setSelectedContacts(visibleRecipients.slice(0,20).map(c=>c.id));setReview(null);}}>{recipientSearch ? "Select matching (up to 20)" : availableContacts.length > 20 ? "Select first 20" : campaignForm.sendMode === "resend" ? "Select all contacted" : "Select all ready"}</button><button type="button" className="button-plain" onClick={()=>{setSelectedContacts([]);setReview(null);}}>Clear</button></div><button className="button" disabled={busy || !connection.connected || selectedContacts.length === 0 || selectedContacts.length > 20 || !campaignForm.templateId || !campaignForm.resumeId}>Preview every message</button></form></section>
        <section className="card review-card"><div className="section-heading"><div><h2>Review before sending</h2><p className="muted small">A personal email for every recipient.</p></div><span className="number-label">02</span></div>{review ? <><p className="muted small">From <strong>{review.senderAddress || connection.email || "your Gmail account"}</strong> · {review.previews.length} individual message{review.previews.length===1?"":"s"} · {review.resume?.label || resumes.find(r=>r.id===campaignForm.resumeId)?.label}</p>{review.skipped?.length ? <div className="alert error">{review.skipped.length} contact{review.skipped.length===1?"":"s"} skipped. Those contacts will not receive an email.<ul>{review.skipped.map((item,index)=><li key={`${item.contactId}-${index}`}>{contacts.find(c=>c.id===item.contactId)?.email || item.contactId}: {(item.reason || "excluded").replaceAll("_"," ")}</li>)}</ul></div> : null}<div style={{maxHeight:500,overflowY:"auto"}}>{review.previews.map((p,index)=><article className="preview" key={`${p.to}-${index}`}><div><strong>To:</strong> {contacts.find(c=>c.id === (p as Preview & {contactId?: string}).contactId)?.recruiterName ? `${contacts.find(c=>c.id === (p as Preview & {contactId?: string}).contactId)?.recruiterName} <${p.to}>` : p.to}</div><div><strong>Subject:</strong> {p.subject}</div>{p.previousDeliveryId && <p className="resend-note">Sending again{p.lastContactedAt ? ` · last accepted by Gmail ${new Date(p.lastContactedAt).toLocaleDateString()}` : ""}</p>}<EmailBody text={p.bodyText || p.body || ""} approvedHtml={p.bodyHtml} /></article>)}</div>{!connection.connected && <div className="alert error">Connect Gmail before sending. Your preview is ready.</div>}{review.previews.length > 0 ? <><button type="button" className="button button-secondary full" disabled={busy || !connection.connected || !review.previews.length} onClick={()=>void sendTest()}>Send test to myself</button><p className="small muted">Sends one real email with the selected PDF to your own connected mailbox, using the first previewed contact’s name and company.</p><div className="spacer"/><button type="button" className="button full" disabled={busy || !connection.connected || !review.previews.length} onClick={()=>void createCampaign()}>{campaignForm.sendMode === "resend" ? "Confirm and resend" : "Confirm and send"} {review.previews.length} individual email{review.previews.length===1?"":"s"}</button><p className="small muted">You will confirm once more before the campaign is queued. Sending continues after you close this page.</p></> : <EmptyState icon="users" title="No new recipients to send to">Choose different contacts or add someone new. The contacts listed above are excluded from this campaign.</EmptyState>}</> : <EmptyState icon="mail" title="See exactly what they’ll receive">Choose your materials and recipients, then preview every message. You’re in control of the final send.</EmptyState>}</section></div></>}

      {tab === "campaigns" && <div className="grid-2"><section className="card"><div className="section-heading"><h2>Campaigns</h2><button type="button" className="button button-small" onClick={()=>setTab("compose")}>New campaign</button></div><div className="list">{campaigns.length ? campaigns.map(c=><button type="button" className={`list-item campaign-row ${selectedCampaign?.id === c.id ? "selected" : ""}`} key={c.id} onClick={()=>void refreshCampaign(c.id)}><div><strong>{c.name}</strong><p>{c.createdAt ? new Date(c.createdAt).toLocaleString() : ""}</p></div><span className={`tag ${statusTone(c.status)}`}>{friendlyStatus(c.status)}</span></button>) : <div className="empty">Your campaigns will appear here after you confirm a send.</div>}</div></section><section className="card"><h2>Campaign results</h2>{selectedCampaign ? <>
        {selectedCampaign.status === "queued" && <div className={selectedCampaign.queueDispatchStatus === "pending" ? "alert error" : "notice"}>
          <strong>{selectedCampaign.queueDispatchStatus === "pending" ? "Your campaign is saved. Sending needs a restart." : "Your introductions are queued"}</strong>
          <p>{selectedCampaign.queueDispatchStatus === "pending" ? "We couldn’t start background sending. Your contacts and reviewed messages are safe. Retry scheduling this campaign below." : selectedCampaign.queueDispatchStatus === "local" ? "The local email worker processes this queue. Keep npm run worker running while testing locally." : "Emails are sent individually in the background. You can close this page and check the results later. If progress stops, restart the remaining queue."}</p>
          <button type="button" className="button button-secondary button-small" disabled={busy || !connection.connected} onClick={() => void run(async () => {
            const result = await api<{ queueDispatchStatus: string }>(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}/dispatch`, { method: "POST" });
            await refreshCampaign(selectedCampaign.id); await refresh();
            if (result.queueDispatchStatus === "pending") throw new Error("Your campaign is saved, but background sending is temporarily unavailable. Try scheduling again shortly.");
          }, "Background sending scheduled. Only remaining queued messages will be processed.")}>{selectedCampaign.queueDispatchStatus === "pending" ? "Retry scheduling" : "Restart sending"}</button>
        </div>}
        <div className="row-between"><div><strong>{selectedCampaign.name}</strong><p className="muted small">From {selectedCampaign.senderAddress || connection.email || "your Gmail account"}</p></div><span className={`tag ${statusTone(selectedCampaign.status)}`}>{friendlyStatus(selectedCampaign.status)}</span></div><div className="row small muted"><span>{selectedCampaign.totals?.accepted || selectedCampaign.totals?.sent || 0} accepted</span><span>·</span><span>{selectedCampaign.totals?.failed || 0} failed</span><span>·</span><span>{selectedCampaign.totals?.queued || 0} queued</span></div>{["queued","running","sending","active"].includes(selectedCampaign.status) && <button type="button" className="button button-secondary button-small" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}/pause`, {method:"POST"});await refreshCampaign(selectedCampaign.id);await refresh();},"Remaining queued emails paused.")}>Pause remaining emails</button>}{selectedCampaign.status === "paused" && <button type="button" className="button button-secondary button-small" disabled={busy || !connection.connected} onClick={()=>void run(async()=>{await api(`/api/campaigns/${encodeURIComponent(selectedCampaign.id)}/resume`,{method:"POST"});await refreshCampaign(selectedCampaign.id);await refresh();},"Campaign resumed.")}>Resume campaign</button>}<button type="button" className="button button-secondary button-small" onClick={exportResults}>Export CSV</button><div className="spacer"/><div className="list">{deliveries.map(d=><div className="list-item" key={d.id}><div><strong>{d.recruiterName || d.to}</strong><p>{d.to}{d.companyName ? ` · ${d.companyName}` : ""}</p>{d.errorCode && <p role="alert">{d.errorMessage || d.errorCode}</p>}</div><div className="row"><span className={`tag ${statusTone(d.status)}`}>{friendlyStatus(d.status)}</span>{d.status === "failed" && selectedCampaign.status !== "paused" && <button type="button" className="button-plain" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/deliveries/${encodeURIComponent(d.id)}/retry`,{method:"POST"});await refreshCampaign(selectedCampaign.id);await refresh();},"Failed send queued for retry.")}>Retry</button>}</div></div>)}</div><p className="small muted">Accepted means Gmail accepted the send request; delivery and reading are not confirmed. Uncertain sends need manual review.</p></> : <div className="empty">Choose a campaign to see individual results.</div>}</section></div>}
    </main>
    </div>
    {confirmation && <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(null)}/>}
  </div>;
}
