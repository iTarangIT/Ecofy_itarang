"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { fmtDateTime, inr, todayIso, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, Empty, Field } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

type Decision = { id: string; attemptNo: number; status: string; financierName: string | null; rejectionReason: string | null; submittedAt: string; decidedAt: string | null; values?: { sanctionedInr: number; downPaymentInr: number | null; tenureMonths: number | null; emiInr: number | null; lenderFileNo: string | null } };
type Otp = { challengeId: string; maskedMobile: string; expiresAt: string };
type DP = { id: string; receivedOn: string; amountInr: number; reference: string | null };

/** M11 + M12 money: decisions (values only for the financier's role), re-acceptance, down payment, disbursement. */
export function FinancingTab({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const admin = s.role === "ECOFY_ADMIN" || s.role === "ITARANG_ADMIN";
  const decisions = useQuery({ queryKey: ["decisions", c.id], queryFn: () => get<Decision[]>(`/cases/${c.id}/financing/decisions`) });
  const dps = useQuery({ queryKey: ["downpayments", c.id], queryFn: () => get<DP[]>(`/cases/${c.id}/down-payment`), enabled: admin });
  const status = useQuery({ queryKey: ["paystatus", c.id], queryFn: () => get<{ downPaymentRecorded: boolean; disbursementRecorded: boolean }>(`/cases/${c.id}/payment-status`) });
  const [f, setF] = useState({ status: "SANCTIONED", sanctionedInr: "", downPaymentInr: "", tenureMonths: "", emiInr: "", lenderFileNo: "", rejectionReason: "" });
  const [dp, setDp] = useState({ receivedOn: todayIso(), amountInr: "", reference: "" });
  const [disb, setDisb] = useState({ disbursedOn: todayIso(), amountInr: "", reference: "" });
  const [otp, setOtp] = useState<Otp | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => { ["decisions", "downpayments", "paystatus"].forEach((k) => qc.invalidateQueries({ queryKey: [k, c.id] })); onChange(); };
  const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); toast(label); refresh(); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); } };
  const open = decisions.data?.data.find((d) => d.status === "SUBMITTED");
  const sanctioned = decisions.data?.data.filter((d) => d.status === "SANCTIONED").slice(-1)[0];

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
        {admin && open && c.stage === "S6" && (
          <form className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-page p-3" onSubmit={(e) => { e.preventDefault(); run(f.status === "SANCTIONED" ? "Sanction recorded" : "Rejection recorded", () => post(`/cases/${c.id}/financing/decisions`, f.status === "SANCTIONED" ? { status: "SANCTIONED", values: { sanctionedInr: Number(f.sanctionedInr), downPaymentInr: f.downPaymentInr ? Number(f.downPaymentInr) : undefined, tenureMonths: f.tenureMonths ? Number(f.tenureMonths) : undefined, emiInr: f.emiInr ? Number(f.emiInr) : undefined, lenderFileNo: f.lenderFileNo || undefined } } : { status: "REJECTED", rejectionReason: f.rejectionReason }, { ifMatch: c.version })); }}>
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
        )}
        {s.role === "ECOFY_ADMIN" && c.subStatus === "REACCEPTANCE_PENDING" && sanctioned && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#f0dcaf] bg-warn-soft p-3 text-[12.5px]">
            <span>Sanction is below the accepted total. Trigger the re-acceptance OTP; the SMS carries the financed amount and down payment (built from your values, never shown to the caller).</span>
            <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => run("Re-acceptance OTP sent", async () => { const r = await post<Otp>(`/cases/${c.id}/reacceptance`, { decisionId: sanctioned.id }, { idempotent: true }); setOtp(r.data); })}>Trigger re-acceptance</button>
            {otp && <span className="text-muted">sent to {otp.maskedMobile}; the caller verifies the code in the Offer tab (challenge {otp.challengeId.slice(0, 8)}…)</span>}
          </div>
        )}
      </Card>
      <Card title="Down payment & disbursement" right={status.data ? `down payment ${status.data.data.downPaymentRecorded ? "recorded" : "not recorded"} · disbursement ${status.data.data.disbursementRecorded ? "recorded" : "not recorded"}` : ""}>
        {admin && (dps.data?.data ?? []).length > 0 && <table className="mb-3 w-full text-[12.5px]"><tbody>{dps.data!.data.map((d) => <tr key={d.id}><td className="td">Down payment received {d.receivedOn}</td><td className="td mono">{inr(d.amountInr)}</td><td className="td text-muted">{d.reference}</td></tr>)}</tbody></table>}
        {!admin && <p className="text-[12.5px] text-muted">Amounts are visible to the financier&apos;s role only; you see status.</p>}
        {admin && (c.stage === "S6" || c.stage === "S7") && (
          <form className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-page p-3" onSubmit={(e) => { e.preventDefault(); run("Down payment recorded", () => post(`/cases/${c.id}/down-payment`, { receivedOn: dp.receivedOn, amountInr: Number(dp.amountInr), reference: dp.reference || undefined })); }}>
            <Field label="Received on"><input className="input" type="date" value={dp.receivedOn} onChange={(e) => setDp((x) => ({ ...x, receivedOn: e.target.value }))} /></Field>
            <Field label="Amount (₹)"><input className="input mono w-36" type="number" required min={1} value={dp.amountInr} onChange={(e) => setDp((x) => ({ ...x, amountInr: e.target.value }))} /></Field>
            <Field label="Reference"><input className="input" value={dp.reference} onChange={(e) => setDp((x) => ({ ...x, reference: e.target.value }))} /></Field>
            <button className="btn btn-green btn-sm" type="submit" disabled={busy}>Record down payment</button>
          </form>
        )}
        {admin && c.stage === "S7" && (
          <form className="flex flex-wrap items-end gap-2 rounded-lg bg-page p-3" onSubmit={(e) => { e.preventDefault(); run("Disbursement recorded — case at S8, asset created", () => post(`/cases/${c.id}/disbursement`, { disbursedOn: disb.disbursedOn, amountInr: Number(disb.amountInr), reference: disb.reference || undefined }, { ifMatch: c.version })); }}>
            <Field label="Disbursed on"><input className="input" type="date" value={disb.disbursedOn} onChange={(e) => setDisb((x) => ({ ...x, disbursedOn: e.target.value }))} /></Field>
            <Field label="Amount (₹)"><input className="input mono w-36" type="number" required min={1} value={disb.amountInr} onChange={(e) => setDisb((x) => ({ ...x, amountInr: e.target.value }))} /></Field>
            <Field label="Reference"><input className="input" value={disb.reference} onChange={(e) => setDisb((x) => ({ ...x, reference: e.target.value }))} /></Field>
            <button className="btn btn-green btn-sm" type="submit" disabled={busy}>Record disbursement → S8</button>
            <span className="w-full text-[11.5px] text-muted">Gate: sanction recorded, installation INSTALLED/COMMISSIONED with photos and the customer acceptance letter.</span>
          </form>
        )}
      </Card>
    </div>
  );
}
