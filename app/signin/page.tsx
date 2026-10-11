"use client";

import { signIn, useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

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
  return <main className="auth-shell"><Link href="/" className="brand">HireHello<span className="brand-dot">.</span></Link><section className="auth-card"><div className="eyebrow">Welcome</div><h1>Your next introduction starts here.</h1><p>Sign in to save your materials and plan your outreach. Gmail sending is connected separately when you are ready.</p><button type="button" className="button full" onClick={handleSignIn} disabled={busy || status === "loading"}>{busy ? "Connecting…" : "Continue with Google"}</button>{error && <p role="alert" className="alert error">{error}</p>}</section></main>;
}
