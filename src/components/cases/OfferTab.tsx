"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, uploadDocument, errorMessage } from "@/lib/api";
import { useEpcPartners, useFinanciers, fmtDateTime, inr, todayIso, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, Empty, Field } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

type Assessment = { id: string; version: number; recommendationStatus: string; confirmedAt: string | null };
type Quote = { id: string; version: number; status: string; provisional: boolean; provisionalReason: string | null; systemDesc: string; equipmentInr: number; installationInr: number; gstInr: number; totalInr: number; validUntil: string; notes: string | null; documentId: string; createdAt: string };
type Offer = { id: string; version: number; status: string; limitCheck: "WITHIN" | "ABOVE" | "UNKNOWN"; provisional: boolean; content: { system: string; equipmentInr: number; installationInr: number; gstInr: number; totalInr: number; financingLine: string; provisionalReason: string | null; validUntil: string }; sentAt: string | null };
type Otp = { challengeId: string; status: string; expiresAt: string; maskedMobile: string; attemptsRemaining: number; resendAfterSeconds: number; devCode?: string };
type FileRec = { id: string; fileNo: string; acceptedTotalInr: number; quoteVersion: number; acceptedAt: string; provisional: boolean; acceptances: Array<{ kind: string; acceptedAt: string }> };

/** M09 + M10: eligibility, EPC quote (versions), offer (within/above limit), OTP and File. */
export function OfferTab({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const itarang = s.role === "ITARANG_CALLER" || s.role === "ITARANG_ADMIN";
  const assessments = useQuery({ queryKey: ["assessments", c.id], queryFn: () => get<Assessment[]>(`/cases/${c.id}/assessments`) });
  const quotes = useQuery({ queryKey: ["quotes", c.id], queryFn: () => get<Quote[]>(`/cases/${c.id}/quotes`) });
  const offers = useQuery({ queryKey: ["offers", c.id], queryFn: () => get<Offer[]>(`/cases/${c.id}/offers`) });
  const file = useQuery({ queryKey: ["file", c.id], queryFn: () => get<FileRec | null>(`/cases/${c.id}/file`) });
  const epcs = useEpcPartners();
  const financiers = useFinanciers(itarang);
  const refresh = () => { ["quotes", "offers", "file", "assessments"].forEach((k) => qc.invalidateQueries({ queryKey: [k, c.id] })); onChange(); };
  const [busy, setBusy] = useState(false);
  const [pdf, setPdf] = useState<File | null>(null);
  const [qf, setQf] = useState({ epcPartnerId: "", assessmentId: "", systemDesc: "", batteryKwh: "", inverterKva: "", solarKwp: "", equipmentInr: "", installationInr: "", gstInr: "", validUntil: "", notes: "", provisional: false, provisionalReason: "" });
  const [otp, setOtp] = useState<Otp | null>(null);
  const [code, setCode] = useState("");
  const [financierId, setFinancierId] = useState("");
  const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); toast(label); refresh(); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); } };
  const active = quotes.data?.data.find((q) => q.status === "ACTIVE" || q.status === "ACCEPTED");
  const liveOffer = offers.data?.data.find((o) => o.status === "DRAFT" || o.status === "SENT" || o.status === "ACCEPTED");
  const latestAssessment = assessments.data?.data[0];
  const pendingAssessment = assessments.data?.data.find((a) => a.id === (qf.assessmentId || latestAssessment?.id))?.recommendationStatus === "PENDING_TECHNICAL_DATA";

  async function uploadQuote(e: React.FormEvent) {
    e.preventDefault();
    if (!pdf) return toast("Choose the EPC quote PDF", "warn");
    setBusy(true);
    try {
      const doc = await uploadDocument(c.id, pdf, "EPC_QUOTE", { quote: true });
      await post(`/cases/${c.id}/quotes`, { documentId: doc.id, assessmentId: qf.assessmentId || latestAssessment?.id, epcPartnerId: qf.epcPartnerId, systemDesc: qf.systemDesc, batteryKwh: qf.batteryKwh ? Number(qf.batteryKwh) : undefined, inverterKva: qf.inverterKva ? Number(qf.inverterKva) : undefined, solarKwp: qf.solarKwp ? Number(qf.solarKwp) : undefined, equipmentInr: Number(qf.equipmentInr), installationInr: Number(qf.installationInr), gstInr: Number(qf.gstInr), validUntil: qf.validUntil, notes: qf.notes || undefined, provisional: qf.provisional || undefined, provisionalReason: qf.provisional ? qf.provisionalReason : undefined }, { idempotent: true });
      toast("Quote uploaded"); setPdf(null); refresh();
    } catch (err) { toast(errorMessage(err), "bad"); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <Card title="Eligibility (Ecofy)" right={`sub-status: ${c.subStatus ?? "—"}`}>
        <p className="text-[12.5px] text-muted">The caller sees only whether the quote is <b>within</b> or <b>above</b> the eligible limit; the amount is visible to Ecofy Admin only (S4.6).</p>
        {itarang && c.stage === "S4" && (
          <div className="mt-2 flex items-end gap-2">
            {s.role === "ITARANG_ADMIN" && <Field label="Financier"><select className="input" value={financierId} onChange={(e) => setFinancierId(e.target.value)}><option value="">Current ({c.financierName ?? "default"})</option>{(financiers.data?.data ?? []).filter((f) => f.active).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>}
            <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => run("Sent for eligibility", () => post(`/cases/${c.id}/eligibility`, { financierId: financierId || undefined }))}>Send for eligibility</button>
          </div>
        )}
      </Card>
      <Card title="EPC quotes" right="the price is the EPC partner's quote; no price override">
        {itarang && c.stage === "S4" && (
          <form onSubmit={uploadQuote} className="mb-3 grid grid-cols-3 gap-2 rounded-lg bg-page p-3">
            <Field label="EPC partner"><select className="input" required value={qf.epcPartnerId} onChange={(e) => setQf((x) => ({ ...x, epcPartnerId: e.target.value }))}><option value="">—</option>{(epcs.data?.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
            <Field label="Answers assessment"><select className="input" value={qf.assessmentId || latestAssessment?.id || ""} onChange={(e) => setQf((x) => ({ ...x, assessmentId: e.target.value }))}>{(assessments.data?.data ?? []).map((a) => <option key={a.id} value={a.id}>v{a.version} · {a.recommendationStatus.replace(/_/g, " ").toLowerCase()}</option>)}</select></Field>
            <Field label="Quote PDF"><input type="file" accept="application/pdf" className="text-[12px]" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} /></Field>
            <div className="col-span-3"><Field label="System description"><input className="input" required minLength={3} value={qf.systemDesc} onChange={(e) => setQf((x) => ({ ...x, systemDesc: e.target.value }))} /></Field></div>
            <Field label="Battery (kWh)"><input className="input mono" type="number" step="0.1" value={qf.batteryKwh} onChange={(e) => setQf((x) => ({ ...x, batteryKwh: e.target.value }))} /></Field>
            <Field label="Inverter (kVA)"><input className="input mono" type="number" step="0.1" value={qf.inverterKva} onChange={(e) => setQf((x) => ({ ...x, inverterKva: e.target.value }))} /></Field>
            <Field label="Solar (kWp)"><input className="input mono" type="number" step="0.1" value={qf.solarKwp} onChange={(e) => setQf((x) => ({ ...x, solarKwp: e.target.value }))} /></Field>
            <Field label="Equipment (₹)"><input className="input mono" type="number" required min={0} value={qf.equipmentInr} onChange={(e) => setQf((x) => ({ ...x, equipmentInr: e.target.value }))} /></Field>
            <Field label="Installation (₹)"><input className="input mono" type="number" required min={0} value={qf.installationInr} onChange={(e) => setQf((x) => ({ ...x, installationInr: e.target.value }))} /></Field>
            <Field label="GST (₹)"><input className="input mono" type="number" required min={0} value={qf.gstInr} onChange={(e) => setQf((x) => ({ ...x, gstInr: e.target.value }))} /></Field>
            <Field label="Valid until"><input className="input" type="date" required min={todayIso()} value={qf.validUntil} onChange={(e) => setQf((x) => ({ ...x, validUntil: e.target.value }))} /></Field>
            <div className="col-span-2"><Field label="Notes"><input className="input" value={qf.notes} onChange={(e) => setQf((x) => ({ ...x, notes: e.target.value }))} /></Field></div>
            {(pendingAssessment || qf.provisional) && (
              <div className="col-span-3 grid grid-cols-[auto_1fr] items-end gap-2 rounded-lg border border-[#f0dcaf] bg-warn-soft p-2">
                <label className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" checked={qf.provisional || pendingAssessment} onChange={(e) => setQf((x) => ({ ...x, provisional: e.target.checked }))} /> Provisional quote</label>
                <Field label="Provisional reason (mandatory — the assessment is pending technical data)"><input className="input" required value={qf.provisionalReason} onChange={(e) => setQf((x) => ({ ...x, provisionalReason: e.target.value }))} /></Field>
              </div>
            )}
            {!pendingAssessment && !qf.provisional && <label className="col-span-3 text-[12px] text-muted"><input type="checkbox" onChange={(e) => setQf((x) => ({ ...x, provisional: e.target.checked }))} /> Mark provisional (reason required)</label>}
            <div className="col-span-3 flex justify-end"><button className="btn btn-primary" type="submit" disabled={busy}>Upload quote {active ? `as v${(active.version ?? 0) + 1} (supersedes v${active.version})` : "v1"}</button></div>
          </form>
        )}
        {(quotes.data?.data ?? []).length === 0 && <Empty>No EPC quote yet.</Empty>}
        <div className="space-y-2">
          {(quotes.data?.data ?? []).map((q) => (
            <div key={q.id} className="rounded-lg border border-line p-3 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2"><b>Quote v{q.version}</b><span className={`chip ${q.status === "ACTIVE" ? "bg-sky-soft text-sky" : q.status === "ACCEPTED" ? "bg-navy text-white" : "bg-chip text-muted"}`}>{q.status}</span>{q.provisional && <span className="chip bg-warn-soft text-warn" title={q.provisionalReason ?? ""}>Provisional</span>}<span className="ml-auto text-muted">valid until {q.validUntil}</span></div>
              <div className="mt-1">{q.systemDesc}</div>
              <div className="mono mt-1">equipment {inr(q.equipmentInr)} + installation {inr(q.installationInr)} + GST {inr(q.gstInr)} = <b>{inr(q.totalInr)}</b></div>
              {q.provisional && <div className="text-warn">Provisional: {q.provisionalReason}</div>}
              <div className="mt-1 flex gap-2"><button className="btn btn-sm" type="button" onClick={async () => { try { const r = await get<{ url: string }>(`/documents/${q.documentId}/download-url`); window.open(r.data.url, "_blank"); } catch (e) { toast(errorMessage(e), "bad"); } }}>Download PDF</button>
                {itarang && c.stage === "S4" && q.status === "ACTIVE" && <button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => run("Offer composed", () => post(`/cases/${c.id}/offers`, { quoteId: q.id }, { idempotent: true }))}>Compose offer from v{q.version}</button>}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Offer & customer acceptance (SMS OTP)" right="no EMI in the offer">
        {!liveOffer && <Empty>No offer yet. Compose it from the ACTIVE quote.</Empty>}
        {liveOffer && (
          <div className="space-y-3 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-2"><b>Offer v{liveOffer.version}</b><span className="chip bg-chip text-teal">{liveOffer.status}</span>
              <span className={`chip ${liveOffer.limitCheck === "WITHIN" ? "bg-ecofy-soft text-ecofy" : liveOffer.limitCheck === "ABOVE" ? "bg-warn-soft text-warn" : "bg-chip text-muted"}`}>{liveOffer.limitCheck === "WITHIN" ? "within eligible limit" : liveOffer.limitCheck === "ABOVE" ? "above eligible limit (warning, not blocked)" : "eligibility unknown"}</span>
              {liveOffer.provisional && <span className="chip bg-warn-soft text-warn">Provisional</span>}</div>
            <dl className="kv"><dt>System</dt><dd>{liveOffer.content.system}</dd><dt>Equipment</dt><dd className="mono">{inr(liveOffer.content.equipmentInr)}</dd><dt>Installation</dt><dd className="mono">{inr(liveOffer.content.installationInr)}</dd><dt>GST</dt><dd className="mono">{inr(liveOffer.content.gstInr)}</dd><dt>Total</dt><dd className="mono font-bold">{inr(liveOffer.content.totalInr)}</dd><dt>Financing</dt><dd>{liveOffer.content.financingLine}</dd>{liveOffer.content.provisionalReason && <><dt>Provisional</dt><dd>{liveOffer.content.provisionalReason}</dd></>}</dl>
            {itarang && (c.stage === "S4" || c.stage === "S5") && liveOffer.status !== "ACCEPTED" && (
              <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
                <button className="btn btn-primary" type="button" disabled={busy} onClick={() => run(c.stage === "S4" ? "OTP sent — case at S5" : "OTP re-sent", async () => { const r = await post<Otp>(`/offers/${liveOffer.id}/otp`, undefined, { ifMatch: c.version, idempotent: true }); setOtp(r.data); })}>{c.stage === "S4" ? "Send offer — SMS OTP to customer" : "Resend OTP"}</button>
                {otp && <span className="text-muted">Sent to {otp.maskedMobile}, expires {fmtDateTime(otp.expiresAt)} · {otp.attemptsRemaining} attempts</span>}
                {otp?.devCode && <span className="chip bg-warn-soft text-warn mono text-[14px] tracking-[0.25em]" title="Sandbox only: OTP_DEV_ECHO is on, so the customer's code is shown here">Sandbox OTP {otp.devCode}</span>}
              </div>
            )}
            {itarang && c.stage === "S5" && (
              <div className="flex items-end gap-2">
                <Field label="Customer's OTP" hint="6 digits · 5 attempts · 10 minutes"><input className="input mono w-40 text-center tracking-[0.3em]" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
                <button className="btn btn-green" type="button" disabled={busy || code.length !== 6 || !otp} onClick={() => run("Accepted — File locked, case at S6", async () => { await post(`/otp/${otp!.challengeId}/verify`, { code }); setCode(""); })}>Verify & lock File</button>
                {!otp && <span className="text-[12px] text-muted">Resend the OTP to get a challenge for this screen.</span>}
              </div>
            )}
          </div>
        )}
      </Card>
      {file.data?.data && (
        <Card title={`File ${file.data.data.fileNo}`} right="never edited or deleted">
          <dl className="kv text-[12.5px]"><dt>Accepted total</dt><dd className="mono font-bold">{inr(file.data.data.acceptedTotalInr)}</dd><dt>Quote version</dt><dd className="mono">v{file.data.data.quoteVersion}</dd><dt>Accepted at</dt><dd>{fmtDateTime(file.data.data.acceptedAt)}</dd><dt>Provisional</dt><dd>{file.data.data.provisional ? "Yes" : "No"}</dd><dt>Acceptances</dt><dd>{file.data.data.acceptances.map((a) => `${a.kind} ${fmtDateTime(a.acceptedAt)}`).join(" · ")}</dd></dl>
        </Card>
      )}
    </div>
  );
}
