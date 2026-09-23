"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { post, errorMessage } from "@/lib/api";
import { Field } from "@/components/ui/primitives";

/**
 * FR-01.1 … FR-01.3: Supabase sign-in in the browser (plain client, no persisted session), tokens handed to
 * POST /auth/session which sets httpOnly cookies; new devices verify an emailed 6-digit code.
 */
function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<"login" | "device">(params.get("step") === "device" ? "device" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const reason = params.get("reason");

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((x) => x - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!url || !anon) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY)");
      const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error || !data.session) throw new Error(error?.message ?? "Sign-in failed");
      const r = await post<{ status: "ACTIVE" | "DEVICE_OTP_SENT"; resendAfterSeconds?: number }>("/auth/session", { accessToken: data.session.access_token, refreshToken: data.session.refresh_token });
      if (r.data.status === "ACTIVE") router.replace("/dashboard");
      else { setStep("device"); setInfo("A 6-digit code was emailed to you. Enter it to trust this device for 30 days."); setResendIn(r.data.resendAfterSeconds ?? 60); }
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await post<{ status: string }>("/auth/device/verify", { code });
      if (r.data.status === "ACTIVE") router.replace("/dashboard");
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true); setErr(null);
    try {
      const r = await post<{ status: string; resendAfterSeconds?: number }>("/auth/device/resend");
      if (r.data.status === "ACTIVE") router.replace("/dashboard");
      else { setInfo("A new code was sent."); setResendIn(r.data.resendAfterSeconds ?? 60); }
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-[22px] font-bold text-navy">iTarang <span className="text-[#3baf7c]">×</span> Ecofy</div>
          <div className="text-[12px] uppercase tracking-[0.1em] text-muted">Lead Workspace</div>
        </div>
        <div className="card">
          <div className="card-b">
            {reason === "SESSION_REPLACED" && <div className="banner banner-amber mb-3">You were signed in elsewhere; this session has ended.</div>}
            {reason === "TENANT" && <div className="banner banner-red mb-3">This host is not a known tenant. Check TENANT_HOSTS and the seed host.</div>}
            {err && <div className="banner banner-red mb-3">{err}</div>}
            {info && step === "device" && <div className="banner banner-green mb-3">{info}</div>}
            {step === "login" ? (
              <form onSubmit={signIn} className="space-y-3">
                <Field label="Email"><input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
                <Field label="Password"><input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
                <button className="btn btn-primary w-full justify-center" disabled={busy} type="submit">{busy ? "Signing in…" : "Sign in"}</button>
                <a className="block text-center text-[12px] text-sky" href="/reset-password">Forgot password?</a>
              </form>
            ) : (
              <form onSubmit={verify} className="space-y-3">
                <Field label="Device verification code" hint="New device: enter the 6-digit code from your email. 5 attempts, then a 15-minute lockout.">
                  <input className="input mono text-center text-[18px] tracking-[0.3em]" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required />
                </Field>
                <button className="btn btn-primary w-full justify-center" disabled={busy || code.length !== 6} type="submit">{busy ? "Verifying…" : "Trust this device"}</button>
                <button className="btn w-full justify-center" type="button" disabled={busy || resendIn > 0} onClick={resend}>{resendIn > 0 ? `Resend in ${resendIn}s` : "Resend code"}</button>
                <button className="block w-full text-center text-[12px] text-muted" type="button" onClick={() => setStep("login")}>Back to sign-in</button>
              </form>
            )}
          </div>
        </div>
        <p className="mt-4 text-center text-[11.5px] text-muted">Tenant #01 on the iTarang Lead Platform · ecofy.itarang.com</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>;
}
