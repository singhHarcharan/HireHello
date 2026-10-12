"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { Brand, Icon } from "./components/hirehello/ui";

export default function Home() {
  const { status } = useSession();
  const destination = status === "authenticated" ? "/dashboard" : "/signin";
  return <main className="landing">
    <nav className="topbar" aria-label="Main navigation"><Link href="/" aria-label="HireHello home"><Brand /></Link><Link className="button button-secondary button-small" href={destination}>{status === "authenticated" ? "My workspace" : "Get started"}<Icon name="arrow" size={16}/></Link></nav>
    <section className="landing-hero">
      <div><span className="hero-kicker"><Icon name="mail" size={14}/>A more personal way to reach out</span><h1>Your next chapter<br/>starts with <em>hello.</em></h1><p>Turn the people you’d love to work with into conversations. Prepare your message once, personalize every introduction, and send it from your Gmail.</p><Link className="button" href={destination}>{status === "authenticated" ? "Open your workspace" : "Start with Google"}<Icon name="arrow" size={17}/></Link><p className="fine-print">Your contacts. Your words. You approve every send.</p></div>
      <div className="hero-preview" aria-label="Example of a personalized email"><div className="sample-mail"><div className="sample-top"><Icon name="mail" size={18}/><strong>A thoughtful introduction</strong><span className="tag good">Example</span></div><strong className="sample-subject">Exploring opportunities at <mark>Acme</mark></strong><p>Hi <mark>Alex</mark>,</p><p>I’m excited about what your team is building at <mark>Acme</mark>. I’d love to learn how my experience could contribute.</p><p>I’ve attached my résumé. Would you be open to a short conversation?</p><p>Thanks,<br/>Your name</p><div className="sample-attachment"><Icon name="file" size={17}/><span>Your résumé.pdf</span><Icon name="check" size={14}/></div></div><span className="preview-caption"><Icon name="users" size={15}/>One template. An individual email for each person.</span></div>
    </section>
    <section className="feature-row" aria-label="How HireHello works"><div><strong>01 / PREPARE</strong><h2>Your essentials, ready to go.</h2><p>Save your email templates and résumés in one place. A good introduction shouldn’t start from scratch.</p></div><div><strong>02 / PERSONALIZE</strong><h2>A hello that feels personal.</h2><p>Add your contacts. Recruiter and company names automatically find their place in every message.</p></div><div><strong>03 / REACH OUT</strong><h2>Review, send, follow along.</h2><p>Preview each email before sending. Track Gmail’s response for every person in your campaign.</p></div></section>
    <footer className="landing-footer"><span>HireHello · Make the first hello count.</span><nav aria-label="Policies and support"><Link href="/privacy">Privacy</Link> · <Link href="/terms">Terms</Link> · <Link href="/support">Support</Link></nav></footer>
  </main>;
}
