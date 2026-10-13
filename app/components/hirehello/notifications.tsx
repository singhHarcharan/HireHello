"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./ui";

export type NoticeTone = "success" | "error" | "info" | "loading";
type NoticeInput = { message: string; tone?: NoticeTone; id?: string; duration?: number };
type Notice = Required<NoticeInput> & { revision: number };
const Notifications = createContext<((notice: NoticeInput) => string) | null>(null);
export const NOTICE_DURATION_MS = 5000;

export function useNotifications() {
  const notify = useContext(Notifications);
  if (!notify) throw new Error("NotificationsProvider is missing");
  return notify;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const sequence = useRef(0);
  const host = useRef<HTMLDivElement>(null);
  const dismiss = useCallback((id: string) => setNotices(items => items.filter(item => item.id !== id)), []);
  const notify = useCallback((input: NoticeInput) => {
    const revision = ++sequence.current;
    const id = input.id || `notice-${revision}`;
    const notice: Notice = { ...input, id, revision, tone: input.tone || "info", duration: input.duration ?? NOTICE_DURATION_MS };
    setNotices(items => [...items.filter(item => item.id !== id), notice].slice(-4));
    return id;
  }, []);

  useEffect(() => {
    // A manual popover puts notifications above native modal dialogs without
    // moving focus. Older browsers keep the ordinary fixed-position fallback.
    const element = host.current;
    if (!element || typeof element.showPopover !== "function") return;
    if (element.matches(":popover-open")) element.hidePopover();
    if (notices.length) element.showPopover();
  }, [notices]);

  return <Notifications.Provider value={notify}>{children}<div ref={host} popover="manual" className="toast-viewport" aria-label="Notifications">{notices.map(notice => <Toast key={`${notice.id}-${notice.revision}`} notice={notice} dismiss={dismiss}/>)}</div></Notifications.Provider>;
}

function Toast({ notice, dismiss }: { notice: Notice; dismiss: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const remaining = useRef(notice.duration);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss(notice.id), remaining.current);
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [paused, notice.id, dismiss]);
  const labels = { success: "Done", error: "Something needs attention", info: "Update", loading: "In progress" };
  return <section className={`toast toast-${notice.tone}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }} style={{ "--toast-duration": `${notice.duration}ms`, "--toast-play-state": paused ? "paused" : "running" } as React.CSSProperties}>
    <span className="toast-icon" aria-hidden="true">{notice.tone === "loading" ? <span className="loading-ring"/> : <Icon name={notice.tone === "success" ? "check" : notice.tone === "error" ? "shield" : "mail"} size={19}/>}</span>
    <div role={notice.tone === "error" ? "alert" : "status"} aria-atomic="true"><strong>{labels[notice.tone]}</strong><p>{notice.message}</p></div>
    <button type="button" className="icon-button toast-close" aria-label={`Dismiss notification: ${notice.message}`} onClick={() => dismiss(notice.id)}><Icon name="close" size={16}/></button><span className="toast-timer" aria-hidden="true"/>
  </section>;
}
