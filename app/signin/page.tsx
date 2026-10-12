"use client";

import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Brand, Icon } from "@/app/components/hirehello/ui";

export default function SignIn() {
  const { status } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (status === "authenticated") router.replace("/dashboard"); }, [status, router]);
  async function handleSignIn() {
    setBusy(true); setError("");
    try {
      const result = await signIn("google", { callbackUrl: "/dashboard" });
      if (result?.error) setError("Google sign-in could not be completed. Please try again.");
    } catch { setError("Google sign-in could not be completed. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell"><Link href="/" aria-label="HireHello home"><Brand /></Link><section className="auth-card"><div className="eyebrow">A new chapter awaits</div><h1>Good opportunities start with a hello.</h1><p>Your templates, résumés, and contacts — together in a workspace built for your next move.</p><button type="button" className="button full" onClick={handleSignIn} disabled={busy || status === "loading"}><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.3c1.9-1.8 2.9-4.3 2.9-7.4ZM12 22c2.7 0 5-.9 6.7-2.4l-3.3-2.5c-.9.6-2 1-3.4 1a6 6 0 0 1-5.6-4.2H3v2.6A10 10 0 0 0 12 22ZM6.4 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.4-2.6ZM12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9A9.6 9.6 0 0 0 12 2a10 10 0 0 0-9 5.5l3.4 2.6A6 6 0 0 1 12 5.9Z"/></svg>{busy ? "Connecting…" : "Continue with Google"}</button><div className="auth-note"><Icon name="shield" size={16}/><span>Sign in to set up your workspace. You’ll connect Gmail sending separately, when you’re ready.</span></div>{error && <p role="alert" className="alert error">{error}</p>}<p className="fine-print">Read our <Link href="/privacy">Privacy policy</Link> and <Link href="/terms">Terms of use</Link>.</p></section><Link className="auth-back" href="/">← Back to HireHello</Link></main>;
}
