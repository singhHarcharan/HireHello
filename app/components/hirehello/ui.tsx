import type { ReactNode } from "react";

const paths = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" /></>,
  layers: <><path d="m12 3 10 5-10 5L2 8Z M2 12l10 5 10-5 M2 16l10 5 10-5" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3 M16 5a3 3 0 0 1 0 6 M21 21v-3a6 6 0 0 0-3-5" /></>,
  send: <><path d="m21 3-7 18-4-7-7-4 18-7Z M10 14 21 3" /></>,
  chart: <><path d="M4 3v18h17 M9 16v-5 M14 16V7 M19 16v-8" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  file: <><path d="M14 3H5v18h14V8Z M14 3v5h5 M8 12h8 M8 16h6" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  logout: <><path d="M9 4H4v16h5 M9 12h12m-5-5 5 5-5 5" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
};

export type IconName = keyof typeof paths;
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function Brand() {
  return <span className="brand"><span className="brand-mark"><Icon name="mail" size={21} /></span>HireHello<span className="brand-dot">.</span></span>;
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <div className="empty"><span className="empty-icon"><Icon name={icon} size={25} /></span><strong>{title}</strong><p>{children}</p></div>;
}
