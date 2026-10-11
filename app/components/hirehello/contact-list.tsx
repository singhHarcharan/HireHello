"use client";

import { useState } from "react";
import type { Contact } from "./api";
import type { OutreachStatus } from "@/lib/core/contact-outreach";
import { EmptyState, Icon } from "./ui";

const filters: { id: OutreachStatus | "all"; label: string }[] = [
  { id: "ready", label: "Ready to contact" }, { id: "contacted", label: "Contacted" },
  { id: "scheduled", label: "Scheduled" }, { id: "needs_review", label: "Needs review" },
  { id: "blocked", label: "Blocked" }, { id: "all", label: "All contacts" },
];
const emptyTitles = { contacted: "Your first introduction is ahead", scheduled: "Nothing is scheduled", needs_review: "No sends need review", blocked: "No blocked contacts", all: "No saved contacts" };
const descriptions: Record<OutreachStatus | "all", string> = {
  ready: "Fresh introductions start here. Only these contacts are available for new campaigns.",
  contacted: "Gmail accepted these emails. Your contact details and campaign history stay here.",
  scheduled: "Already in a campaign, including paused campaigns. They cannot be selected again.",
  needs_review: "A send could not be confirmed. Check Gmail Sent before taking further action; resending is blocked.",
  blocked: "These addresses are blocked from future sends.",
  all: "Your address book and outreach history, together.",
};

export function ContactList({ contacts, busy, onEdit, onBlock, onRemove, onHistory }: {
  contacts: Contact[]; busy: boolean;
  onEdit: (contact: Contact) => void; onBlock: (contact: Contact) => void;
  onRemove: (contact: Contact) => void; onHistory: (id: string) => void;
}) {
  const [filter, setFilter] = useState<OutreachStatus | "all">("ready");
  const [search, setSearch] = useState("");
  const visible = contacts.filter(contact => (filter === "all" || contact.outreachStatus === filter)
    && `${contact.recruiterName} ${contact.emailNormalized} ${contact.companyName}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="card contact-library">
    <div className="section-heading"><div><h2>Your contacts <span className="count-badge">{contacts.length}</span></h2><p className="muted small">One introduction. No manual cleanup.</p></div><div className="search-field"><Icon name="search" size={18}/><input aria-label="Search contacts" placeholder="Search contacts…" value={search} onChange={event => setSearch(event.target.value)}/></div></div>
    <div className="contact-filters" role="group" aria-label="Filter contacts by outreach status">{filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{item.id === "all" ? contacts.length : contacts.filter(contact => contact.outreachStatus === item.id).length}</span></button>)}</div>
    <p className="muted small filter-description">{descriptions[filter]}</p>
    {visible.length ? <div className="table-wrap"><table><thead><tr><th>Person</th><th>Company</th><th>Outreach</th><th>Actions</th></tr></thead><tbody>{visible.map(contact => <tr key={contact.id}>
      <td><div className="contact-person"><span className="contact-avatar" aria-hidden="true">{contact.recruiterName.slice(0,1).toUpperCase()}</span><div><strong>{contact.recruiterName}</strong><span>{contact.email || contact.emailNormalized}</span></div></div></td><td>{contact.companyName}</td>
      <td><span className={`tag ${["ready", "contacted"].includes(contact.outreachStatus) ? "good" : contact.outreachStatus === "blocked" ? "bad" : "warn"}`}>{filters.find(item => item.id === contact.outreachStatus)?.label}</span>{contact.contactedAt && <span className="contact-date">{new Date(contact.contactedAt).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})}</span>}</td>
      <td><div className="contact-actions">{contact.campaignId && <button className="button-plain" onClick={() => onHistory(contact.campaignId!)}>View campaign<Icon name="arrow" size={14}/></button>}<button type="button" className="button-plain" disabled={busy || contact.outreachStatus === "blocked"} onClick={() => onEdit(contact)}>Edit</button>{contact.outreachStatus !== "blocked" && <button type="button" className="button-plain" disabled={busy} onClick={() => onBlock(contact)}>Block sends</button>}<button type="button" className="button-plain remove-action" disabled={busy} onClick={() => onRemove(contact)}>Remove</button></div></td>
    </tr>)}</tbody></table></div> : <EmptyState icon={search ? "search" : filter === "ready" && contacts.length ? "check" : "users"} title={search ? "No matching contacts" : filter === "ready" && contacts.length ? "Your list is up to date" : filter === "ready" ? "Who would you like to meet?" : emptyTitles[filter]}>
      {search ? "Try another name, email, or company, or choose a different filter." : filter === "ready" ? "Add someone new above. Scheduled and contacted people are automatically kept out of this list." : "Contacts appear here automatically as your outreach progresses."}
    </EmptyState>}
    <div className="contact-library-footer"><Icon name="shield" size={15}/><span>One send per email address. Reimporting a contacted address keeps its history.</span></div>
  </section>;
}
