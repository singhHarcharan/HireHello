"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./ui";

export type Confirmation = {
  title: string;
  description: string;
  label: string;
  subject?: string;
  detail?: string;
  tone?: "danger" | "primary";
  icon?: IconName;
  action: () => Promise<void>;
};

export function ConfirmDialog({ confirmation, onClose }: { confirmation: Confirmation; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    element.showModal();
    cancel.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);

  async function confirm() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError("");
    try { await confirmation.action(); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "That didn’t work. Please try again."); }
    finally { pending.current = false; setBusy(false); }
  }

  return <dialog ref={dialog} className={`confirm-dialog ${confirmation.tone === "primary" ? "" : "is-danger"}`} aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} onCancel={event => { event.preventDefault(); if (!pending.current) onClose(); }}>
    <div className="dialog-body">
      <div className="dialog-top"><span className="dialog-symbol"><Icon name={confirmation.icon || "shield"} size={26}/></span><button type="button" className="icon-button" aria-label="Close confirmation" disabled={busy} onClick={onClose}><Icon name="close"/></button></div>
      <div className="eyebrow">{confirmation.tone === "primary" ? "One last check" : "Confirm change"}</div>
      <h2 id={titleId}>{confirmation.title}</h2>
      <p id={descriptionId} className="muted">{confirmation.description}</p>
      {confirmation.subject && <div className="dialog-subject"><Icon name={confirmation.icon || "file"}/><div><strong>{confirmation.subject}</strong>{confirmation.detail && <span>{confirmation.detail}</span>}</div></div>}
      {error && <div className="alert error" role="alert">{error}</div>}
    </div>
    <div className="dialog-actions"><button ref={cancel} type="button" className="button button-secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={`button ${confirmation.tone === "primary" ? "" : "button-danger"}`} disabled={busy} onClick={() => void confirm()}>{busy ? <><span className="loading-ring"/>Working…</> : confirmation.label}</button></div>
  </dialog>;
}
