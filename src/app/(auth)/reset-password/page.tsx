"use client";

import { Suspense, useEffect, useState } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Field } from "@/components/ui/primitives";

/**
 * Password set/reset landing for Supabase invite and recovery links (FR-01.10). The link carries the
 * session in the URL hash; the page sets the new password and sends the user to /login.
 */
function ResetInner() {
  const [sb] = useState<SupabaseClient | null>(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    return url && anon ? createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: true } }) : null;
  });
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sb) return;
    const { data } = sb.auth.onAuthStateChange((event, session) => { if (session) setReady(true); if (event === "PASSWORD_RECOVERY") setReady(true); });
    sb.auth.getSession().then(({ data: d }) => { if (d.session) setReady(true); });
    return () => data.subscription.unsubscribe();
  }, [sb]);
  const shownErr = err ?? (sb ? null : "Supabase is not configured");

  async function setNew(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    setErr(null);
    const { error } = await sb.auth.updateUser({ password });
    if (error) setErr(error.message);
    else { setMsg("Password saved. You can sign in now."); setTimeout(() => (window.location.href = "/login"), 1500); }
  }

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    if (!sb) return;
    setErr(null);
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
    if (error) setErr(error.message);
    else setMsg("If the email exists, a reset link is on its way.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="card w-full max-w-sm">
        <div className="card-h">{ready ? "Set your password" : "Reset password"}</div>
        <div className="card-b space-y-3">
          {shownErr && <div className="banner banner-red">{shownErr}</div>}
          {msg && <div className="banner banner-green">{msg}</div>}
          {ready ? (
            <form onSubmit={setNew} className="space-y-3">
              <Field label="New password" hint="At least 8 characters."><input className="input" type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
              <button className="btn btn-primary w-full justify-center" type="submit">Save password</button>
            </form>
          ) : (
            <form onSubmit={sendLink} className="space-y-3">
              <Field label="Email"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
              <button className="btn btn-primary w-full justify-center" type="submit">Email me a reset link</button>
              <a className="block text-center text-[12px] text-sky" href="/login">Back to sign-in</a>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return <Suspense><ResetInner /></Suspense>;
}
