"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      setMessage("Check your email for the secure WAR ROOM sign-in link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start sign-in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-wrap">
      <section className="hero-panel">
        <div><p className="eyebrow">WAR ROOM ACCOUNT</p><h1>Keep your league intelligence between sessions.</h1><p className="lede">Sign in by secure email link. Saved leagues are protected by row-level security in the dedicated WAR ROOM database.</p></div>
        <Link href="/connect" className="status-chip">BACK TO SLEEPER</Link>
      </section>
      <section className="section-block connect-panel">
        <form onSubmit={submit} className="connect-form">
          <label htmlFor="email">Email address</label>
          <div className="connect-row"><input id="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/><button className="connect-button" disabled={busy}>{busy ? "Sending…" : "Email sign-in link"}</button></div>
          {message ? <p className="metric-detail">{message}</p> : null}
        </form>
      </section>
    </div>
  );
}
