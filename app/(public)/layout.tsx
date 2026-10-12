import Link from 'next/link';
import { Brand } from '@/app/components/hirehello/ui';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <main className="legal-shell"><nav className="topbar" aria-label="Main navigation"><Link href="/" aria-label="HireHello home"><Brand /></Link><Link className="button button-secondary button-small" href="/dashboard">My workspace</Link></nav><article className="legal-content">{children}</article><footer className="landing-footer"><span>HireHello</span><nav aria-label="Policies and support"><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/support">Support</Link></nav></footer></main>;
}
