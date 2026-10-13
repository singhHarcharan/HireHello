"use client";

import { useRef, useState } from 'react';
import { insertMergeField } from '@/lib/core/email-body';
import { EmailBody } from './email-body';
import { useNotifications } from './notifications';

export function EmailEditor({ value, onChange, senderName }: { value: string; onChange: (text: string) => void; senderName: string }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const [preview, setPreview] = useState(false);
  const notify = useNotifications();
  const samples: Record<string, string> = { recruiterName: 'Maya', companyName: 'Acme', senderName };
  function insert(field: string) {
    const { start, end } = selection.current;
    const next = insertMergeField(value, field, Math.min(start, value.length), Math.min(end, value.length));
    if (next.text.length > 12000) { notify({ tone: 'error', message: 'The email body can contain up to 12,000 characters.' }); return; }
    onChange(next.text);
    selection.current = { start: next.caret, end: next.caret };
    requestAnimationFrame(() => { textarea.current?.focus(); textarea.current?.setSelectionRange(next.caret, next.caret); });
  }
  return <div className="field">
    <div className="email-editor-heading"><label htmlFor="template-body">Email body</label><div className="email-view-switch" role="group" aria-label="Email view"><button type="button" aria-pressed={!preview} onClick={() => setPreview(false)}>Write</button><button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>Recipient preview</button></div></div>
    <div hidden={preview}>
      <textarea ref={textarea} id="template-body" required={!preview} maxLength={12000} value={value} aria-describedby="email-format-help" onSelect={e => { selection.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }; }} onChange={e => onChange(e.target.value)} placeholder={'Hi {{recruiterName}},\n\nI’m interested in opportunities at {{companyName}}…\n\nThanks,\n{{senderName}}'} />
      <div className="merge-help"><span>Insert at cursor</span>{['recruiterName','companyName','senderName'].map(field => <button type="button" key={field} title={`Insert ${field} at the cursor or replace selected text`} onClick={() => insert(field)}>{`{{${field}}}`}</button>)}</div>
    </div>
    {preview && <div className="email-editor-preview"><p className="small muted">Example recipient: Maya at Acme. Your campaign preview uses real names.</p>{value.trim() ? <EmailBody text={value.replace(/\{\{(recruiterName|companyName|senderName)\}\}/g, (_, field: string) => samples[field])} /> : <p className="muted">Write your message to see how it will look.</p>}</div>}
    <p id="email-format-help" className="small muted email-format-help">Blank lines separate paragraphs. Use • or - for bullets and “LinkedIn: https://…” for a short link. Long pasted lines flow naturally; short signature lines stay separate. End a line with two spaces to keep an intentional break.</p>
    <p className="small muted">Preview uses the same formatting as outgoing email. Fonts and spacing can vary by email app.</p>
  </div>;
}
