"use client";

// M11 + M12 money: decisions (values only for the financier's role), re-acceptance, down payment, disbursement.
// Each block is exported on its own so the CurrentStepCard can show the one the case needs next.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { fmtDateTime, inr, todayIso, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, Empty, Field } from "@/components/ui/primitives";
import { useCaseAction } from "./shared";

type P = { c: CaseSummary; onChange: () => void };
export type Decision = { id: string; attemptNo: number; status: string; financierName: string | null; rejectionReason: string | null; submittedAt: string; decidedAt: string | null; values?: { sanctionedInr: number; downPaymentInr: number | null; tenureMonths: number | null; emiInr: number | null; lenderFileNo: string | null } };
type Otp = { challengeId: string; maskedMobile: string; expiresAt: string; devCode?: string };
type DP = { id: string; receivedOn: string; amountInr: number; reference: string | null };
export type PaymentStatus = { downPaymentRecorded: boolean; disbursementRecorded: boolean };

export const isOpenDecision = (d: Decision) => d.status === "SUBMITTED";
const MONEY_KEYS = ["decisions", "downpayments", "paystatus", "reacceptance"];
const isAdmin = (role: string) => role === "ECOFY_ADMIN" || role === "ITARANG_ADMIN";

/** S6, admins: record the financier's sanction / rejection while a decision is open. */
export function FinancingDecisionForm({ c, onChange }: P) {
  const s = useSession();
  const decisions = useQuery({ queryKey: ["decisions", c.id], queryFn: () => get<Decision[]>(`/cases/${c.id}/financing/decisions`) });
  const { busy, run } = useCaseAction(c.id, onChange, MONEY_KEYS);
  const [f, setF] = useState({ status: "SANCTIONED", sanctionedInr: "", downPaymentInr: "", tenureMonths: "", emiInr: "", lenderFileNo: "", rejectionReason: "" });
  const open = decisions.data?.data.find(isOpenDecision);
  if (!isAdmin(s.role) || !open || c.stage !== "S6") return null;
  return (
    <form className="grid grid-cols-3 gap-2 rounded-lg bg-page p-3" onSubmit={(e) => { e.preventDefault(); run(f.status === "SANCTIONED" ? "Sanction recorded" : "Rejection recorded", () => post(`/cases/${c.id}/financing/decisions`, f.status === "SANCTIONED" ? { status: "SANCTIONED", values: { sanctionedInr: Number(f.sanctionedInr), downPaymentInr: f.downPaymentInr ? Number(f.downPaymentInr) : undefined, tenureMonths: f.tenureMonths ? Number(f.tenureMonths) : undefined, emiInr: f.emiInr ? Number(f.emiInr) : undefined, lenderFileNo: f.lenderFileNo || undefined } } : { status: "REJECTED", rejectionReason: f.rejectionReason }, { ifMatch: c.version })); }}>
      <Field label="Decision"><select className="input" value={f.status} onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))}><option value="SANCTIONED">Sanctioned</option><option value="REJECTED">Rejected</option></select></Field>
      {f.status === "SANCTIONED" ? (<>
        <Field label="Sanctioned amount (₹)" hint="Below the accepted total → re-acceptance OTP"><input className="input mono" type="number" required min={1} value={f.sanctionedInr} onChange={(e) => setF((x) => ({ ...x, sanctionedInr: e.target.value }))} /></Field>
        <Field label="Down payment (₹)"><input className="input mono" type="number" min={0} value={f.downPaymentInr} onChange={(e) => setF((x) => ({ ...x, downPaymentInr: e.target.value }))} /></Field>
        <Field label="Tenure (months)"><input className="input mono" type="number" min={1} max={120} value={f.tenureMonths} onChange={(e) => setF((x) => ({ ...x, tenureMonths: e.target.value }))} /></Field>
        <Field label="EMI from lender (₹, recorded not calculated)"><input className="input mono" type="number" min={0} value={f.emiInr} onChange={(e) => setF((x) => ({ ...x, emiInr: e.target.value }))} /></Field>
        <Field label="Lender file no."><input className="input" value={f.lenderFileNo} onChange={(e) => setF((x) => ({ ...x, lenderFileNo: e.target.value }))} /></Field>
      </>) : (
        <div className="col-span-2"><Field label="Rejection reason (mandatory)"><input className="input" required minLength={3} value={f.rejectionReason} onChange={(e) => setF((x) => ({ ...x, rejectionReason: e.target.value }))} /></Field></div>
      )}
      <div className="col-span-3 flex justify-end"><button className="btn btn-green" type="submit" disabled={busy}>Record decision</button></div>
    </form>
  );
}

/** S6 REACCEPTANCE_PENDING, Ecofy Admin: trigger (or resend) the re-acceptance OTP and verify it in place (CONFLICTS #28). */
export function ReacceptancePanel({ c, onChange }: P) {
  const s = useSession();
  const reacceptancePending = c.stage === "S6" && c.subStatus === "REACCEPTANCE_PENDING";
  const decisions = useQuery({ queryKey: ["decisions", c.id], queryFn: () => get<Decision[]>(`/cases/${c.id}/financing/decisions`), enabled: s.role === "ECOFY_ADMIN" && reacceptancePending });
  const live = useQuery({ queryKey: ["reacceptance", c.id], queryFn: () => get<Otp | null>(`/cases/${c.id}/reacceptance`), enabled: s.role === "ECOFY_ADMIN" && reacceptancePending });
  const { busy, run } = useCaseAction(c.id, onChange, MONEY_KEYS);
  const [otp, setOtp] = useState<Otp | null>(null);
  const [code, setCode] = useState("");
  if (s.role !== "ECOFY_ADMIN" || !reacceptancePending) return null;
  const sanctioned = decisions.data?.data.filter((d) => d.status === "SANCTIONED").slice(-1)[0];
  if (!sanctioned) return null;
  const challenge = otp ?? live.data?.data ?? null;
  return (
    <div className="space-y-2 rounded-lg border border-[#f0dcaf] bg-warn-soft p-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2">
        <span>Sanction is below the accepted total. Trigger the re-acceptance OTP; the SMS carries the financed amount and down payment (built from your values, never shown to the caller).</span>
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => run("Re-acceptance OTP sent", async () => { const r = await post<Otp>(`/cases/${c.id}/reacceptance`, { decisionId: sanctioned.id }, { idempotent: true }); setOtp(r.data); setCode(""); })}>{challenge ? "Resend re-acceptance OTP" : "Trigger re-acceptance"}</button>
        {challenge && <span className="text-muted">sent to {challenge.maskedMobile}, expires {fmtDateTime(challenge.expiresAt)}</span>}
        {challenge?.devCode && <button type="button" className="chip bg-warn-soft text-warn mono text-[14px] tracking-[0.25em]" title="Sandbox only: OTP_DEV_ECHO is on, so the customer's code is shown here. Click to fill it in." onClick={() => setCode(challenge.devCode!)}>Sandbox OTP {challenge.devCode}</button>}
      </div>
      {challenge && (
        <div className="flex flex-wrap items-end gap-2 border-t border-[#f0dcaf] pt-2">
          <Field label="Customer's OTP" hint="6 digits · the code the customer reads out"><input className="input mono w-40 text-center tracking-[0.3em]" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
          <button className="btn btn-green" type="button" disabled={busy || code.length !== 6} onClick={() => run("Re-accepted — revised terms confirmed, case at S7", async () => { await post(`/otp/${challenge.challengeId}/verify`, { code }); setCode(""); setOtp(null); })}>Verify re-acceptance</button>
          <span className="text-[12px] text-muted">The caller can also verify it from the Offer tab.</span>
        </div>
      )}
    </div>
  );
}

/**
 * The recorded down payment — one per case. Rows recorded before the
 * one-per-case guard (same case, several clicks) are folded under a disclosure
 * instead of repeating on the page.
 */
export function DownPaymentList({ c }: { c: CaseSummary }) {
  const s = useSession();
  const dps = useQuery({ queryKey: ["downpayments", c.id], queryFn: () => get<DP[]>(`/cases/${c.id}/down-payment`), enabled: isAdmin(s.role) });
  const rows = dps.data?.data ?? [];
  if (!rows.length) return null;
  const [first, ...rest] = rows;
  const row = (d: DP) => <tr key={d.id}><td className="td">Down payment received {d.receivedOn}</td><td className="td mono">{inr(d.amountInr)}</td><td className="td text-muted">{d.reference}</td></tr>;
  return (
    <div className="text-[12.5px]">
      <table className="w-full"><tbody>
        <tr key={first.id}><td className="td"><span className="chip bg-ecofy-soft text-ecofy mr-2">recorded</span>Down payment received {first.receivedOn}</td><td className="td mono">{inr(first.amountInr)}</td><td className="td text-muted">{first.reference}</td></tr>
      </tbody></table>
      {rest.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[12px] text-muted">{rest.length} earlier duplicate {rest.length === 1 ? "entry" : "entries"} (recorded before the one-per-case rule) ▸</summary>
          <table className="w-full"><tbody>{rest.map(row)}</tbody></table>
        </details>
      )}
    </div>
  );
}

/**
 * S6–S7, the financier's admin: record the down payment Ecofy received.
 * One per case — the form disappears once one is recorded (the API refuses a
 * second one too), and its fields reset after success.
 */
export function DownPaymentForm({ c, onChange }: P) {
  const s = useSession();
  const status = useQuery({ queryKey: ["paystatus", c.id], queryFn: () => get<PaymentStatus>(`/cases/${c.id}/payment-status`) });
  const dps = useQuery({ queryKey: ["downpayments", c.id], queryFn: () => get<DP[]>(`/cases/${c.id}/down-payment`), enabled: isAdmin(s.role) });
  const { busy, run } = useCaseAction(c.id, onChange, MONEY_KEYS);
  const fresh = () => ({ receivedOn: todayIso(), amountInr: "", reference: "" });
  const [dp, setDp] = useState(fresh);
  if (!isAdmin(s.role) || !(c.stage === "S6" || c.stage === "S7")) return null;
  if (status.isLoading || status.data?.data.downPaymentRecorded || (dps.data?.data ?? []).length > 0) return null;
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-lg bg-page p-3" onSubmit={async (e) => { e.preventDefault(); const ok = await run("Down payment recorded", () => post(`/cases/${c.id}/down-payment`, { receivedOn: dp.receivedOn, amountInr: Number(dp.amountInr), reference: dp.reference || undefined })); if (ok) setDp(fresh()); }}>
      <Field label="Received on"><input className="input" type="date" value={dp.receivedOn} onChange={(e) => setDp((x) => ({ ...x, receivedOn: e.target.value }))} /></Field>
      <Field label="Amount (₹)"><input className="input mono w-36" type="number" required min={1} value={dp.amountInr} onChange={(e) => setDp((x) => ({ ...x, amountInr: e.target.value }))} /></Field>
      <Field label="Reference"><input className="input" value={dp.reference} onChange={(e) => setDp((x) => ({ ...x, reference: e.target.value }))} /></Field>
      <button className="btn btn-green btn-sm" type="submit" disabled={busy}>Record down payment</button>
    </form>
  );
}

/** S7, the financier's admin: record the disbursement → S8 (asset created). */
export function DisbursementForm({ c, onChange }: P) {
  const s = useSession();
  const { busy, run } = useCaseAction(c.id, onChange, MONEY_KEYS);
  const [disb, setDisb] = useState({ disbursedOn: todayIso(), amountInr: "", reference: "" });
  if (!isAdmin(s.role) || c.stage !== "S7") return null;
  return (
    <form className="flex flex-wrap items-end gap-2 rounded-lg bg-page p-3" onSubmit={(e) => { e.preventDefault(); run("Disbursement recorded — case at S8, asset created", () => post(`/cases/${c.id}/disbursement`, { disbursedOn: disb.disbursedOn, amountInr: Number(disb.amountInr), reference: disb.reference || undefined }, { ifMatch: c.version })); }}>
      <Field label="Disbursed on"><input className="input" type="date" value={disb.disbursedOn} onChange={(e) => setDisb((x) => ({ ...x, disbursedOn: e.target.value }))} /></Field>
      <Field label="Amount (₹)"><input className="input mono w-36" type="number" required min={1} value={disb.amountInr} onChange={(e) => setDisb((x) => ({ ...x, amountInr: e.target.value }))} /></Field>
      <Field label="Reference"><input className="input" value={disb.reference} onChange={(e) => setDisb((x) => ({ ...x, reference: e.target.value }))} /></Field>
      <button className="btn btn-green btn-sm" type="submit" disabled={busy}>Record disbursement → S8</button>
      <span className="w-full text-[11.5px] text-muted">Gate: sanction recorded, installation INSTALLED/COMMISSIONED with photos and the customer acceptance letter.</span>
    </form>
  );
}

export function FinancingTab({ c, onChange }: P) {
  const s = useSession();
  const decisions = useQuery({ queryKey: ["decisions", c.id], queryFn: () => get<Decision[]>(`/cases/${c.id}/financing/decisions`) });
  const status = useQuery({ queryKey: ["paystatus", c.id], queryFn: () => get<PaymentStatus>(`/cases/${c.id}/payment-status`) });
  const admin = isAdmin(s.role);

  return (
    <div className="space-y-4">
      <Card title="Financing decisions" right={c.financierName ? `financier: ${c.financierName}` : ""}>
        {(decisions.data?.data ?? []).length === 0 && <Empty>No File yet — financing starts when the customer accepts the offer.</Empty>}
        <div className="space-y-2">
          {(decisions.data?.data ?? []).map((d) => (
            <div key={d.id} className="rounded-lg border border-line p-3 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2"><b>Attempt {d.attemptNo}</b> · {d.financierName}<span className={`chip ${d.status === "SANCTIONED" ? "bg-ecofy-soft text-ecofy" : d.status === "REJECTED" ? "bg-bad-soft text-bad" : d.status === "CANCELLED" ? "bg-chip text-muted" : "bg-warn-soft text-warn"}`}>{d.status}</span><span className="ml-auto text-muted">{fmtDateTime(d.decidedAt ?? d.submittedAt)}</span></div>
              {d.rejectionReason && <div className="text-bad">Reason: {d.rejectionReason}</div>}
              {d.values ? (
                <dl className="kv mt-2"><dt>Sanctioned</dt><dd className="mono font-bold">{inr(d.values.sanctionedInr)}</dd><dt>Down payment</dt><dd className="mono">{inr(d.values.downPaymentInr)}</dd><dt>Tenure</dt><dd>{d.values.tenureMonths ?? "—"} months</dd><dt>EMI (lender)</dt><dd className="mono">{inr(d.values.emiInr)}</dd><dt>Lender file no.</dt><dd className="mono">{d.values.lenderFileNo ?? "—"}</dd></dl>
              ) : d.status === "SANCTIONED" ? <div className="mt-1 text-muted">Amounts are visible only to the financier&apos;s role.</div> : null}
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-3">
          <FinancingDecisionForm c={c} onChange={onChange} />
          <ReacceptancePanel c={c} onChange={onChange} />
        </div>
      </Card>
      <Card title="Down payment & disbursement" right={status.data ? `down payment ${status.data.data.downPaymentRecorded ? "recorded" : "not recorded"} · disbursement ${status.data.data.disbursementRecorded ? "recorded" : "not recorded"}` : ""}>
        <div className="space-y-3">
          <DownPaymentList c={c} />
          {!admin && <p className="text-[12.5px] text-muted">Amounts are visible to the financier&apos;s role only; you see status.</p>}
          <DownPaymentForm c={c} onChange={onChange} />
          <DisbursementForm c={c} onChange={onChange} />
        </div>
      </Card>
    </div>
  );
}
