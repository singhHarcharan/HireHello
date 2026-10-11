"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";

export default function Home() {
  const { status } = useSession();
  return (
    <main className="landing">
      <nav className="topbar"><Link href="/" className="brand">HireHello<span className="brand-dot">.</span></Link><Link className="button button-small" href={status === "authenticated" ? "/dashboard" : "/signin"}>{status === "authenticated" ? "Open dashboard" : "Get started"}</Link></nav>
      <section className="hero">
        <div className="eyebrow">Personal outreach, made simpler</div>
        <h1>Make the first hello count.</h1>
        <p>Save your résumé and email templates, add the people you want to reach, review every personalized message, then send individual emails from your own Gmail account.</p>
        <Link className="button" href={status === "authenticated" ? "/dashboard" : "/signin"}>Start with Google <span aria-hidden="true">→</span></Link>
        <p className="fine-print">You choose your contacts and confirm every campaign before it sends.</p>
      </section>
      <section className="feature-row" aria-label="How HireHello works"><div><strong>01</strong><h2>Prepare once</h2><p>Keep your templates and PDF résumés ready.</p></div><div><strong>02</strong><h2>Personalize each</h2><p>Use recruiter and company names in every message.</p></div><div><strong>03</strong><h2>Track progress</h2><p>See which messages Gmail accepted and which need attention.</p></div></section>
    </main>
  );
}
