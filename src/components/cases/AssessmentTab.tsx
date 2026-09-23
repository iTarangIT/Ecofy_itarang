"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { fmtDateTime, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, Empty, Field } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { Calculator, type CalcResultView } from "@/components/calculator/Calculator";

type Assessment = { id: string; version: number; method: string; releaseId: string | null; recommendationStatus: string; recommendedCode: string | null; selectedCode: string | null; overrideReason: string | null; confirmedAt: string | null; createdAt: string; inputs: Record<string, unknown>; result: CalcResultView & { steps: Record<string, number | null> } };

/** M07: calculator or manual/EPC assessment; confirm closes S3. C&I never shows the calculator (FR-07.11). */
export function AssessmentTab({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assessments", c.id], queryFn: () => get<Assessment[]>(`/cases/${c.id}/assessments`) });
  const canSave = (s.role === "ECOFY_USER" && c.stage === "S0") || ((s.role === "ITARANG_CALLER" || s.role === "ITARANG_ADMIN") && c.stage !== "CLOSED");
  const canConfirm = (s.role === "ITARANG_CALLER" || s.role === "ITARANG_ADMIN") && c.stage === "S3";
  const [mode, setMode] = useState<"CALCULATOR" | "MANUAL" | "EPC">(c.segment === "CI" ? "EPC" : "CALCULATOR");
  const [manual, setManual] = useState({ batteryKwh: "", inverterKva: "", solarKwp: "", sourceNote: "" });
  const [override, setOverride] = useState({ selectedSystemCode: "", overrideReason: "" });
  const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["assessments", c.id] }); onChange(); };

  async function saveCalc(input: Record<string, unknown>, result: CalcResultView) {
    setBusy(true);
    try {
      const rec = result.options.find((o) => o.role === "RECOMMENDED")?.systemCode;
      const sel = override.selectedSystemCode || undefined;
      await post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: input, selectedSystemCode: sel, overrideReason: sel && sel !== rec ? override.overrideReason || undefined : undefined });
      toast("Assessment saved"); refresh();
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }
  async function saveManual(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/cases/${c.id}/assessments`, { method: mode, manual: { batteryKwh: manual.batteryKwh ? Number(manual.batteryKwh) : undefined, inverterKva: manual.inverterKva ? Number(manual.inverterKva) : undefined, solarKwp: manual.solarKwp ? Number(manual.solarKwp) : undefined, sourceNote: manual.sourceNote } });
      toast("Assessment saved"); refresh();
    } catch (err) { toast(errorMessage(err), "bad"); } finally { setBusy(false); }
  }
  async function confirm(id: string) {
    setBusy(true);
    try { await post(`/assessments/${id}/confirm`, undefined, { ifMatch: c.version }); toast("Assessment confirmed — case at S4"); refresh(); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }
  const latest = q.data?.data[0];
  const statusChip = (st: string) => <span className={`chip ${st === "RECOMMENDED" ? "bg-ecofy-soft text-ecofy" : st === "CUSTOM_REQUIRED" ? "bg-epc-soft text-epc" : "bg-warn-soft text-warn"}`}>{st.replace(/_/g, " ")}</span>;

  return (
    <div className="space-y-4">
      {canSave && (
        <Card title="New assessment" right={c.segment === "CI" ? "C&I: EPC quote required — calculator off" : `latest version ${latest?.version ?? 0}`}>
          {c.segment !== "CI" && (
            <div className="mb-3 flex gap-1">
              {(["CALCULATOR", "MANUAL", "EPC"] as const).map((m) => <button key={m} type="button" className={`btn btn-sm ${mode === m ? "btn-navy" : ""}`} onClick={() => setMode(m)}>{m === "CALCULATOR" ? "Calculator" : m === "MANUAL" ? "Manual entry" : "EPC sizing"}</button>)}
            </div>
          )}
          {mode === "CALCULATOR" ? (
            <Calculator segment={c.segment as "RESI" | "ESS" | "CI"} defaults={{ productInterest: c.productInterest ?? undefined, monthlyUnits: undefined, sanctionedLoadKw: c.sanctionedLoadKw ?? undefined }} onSave={saveCalc} saving={busy}
              extra={(result) => (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Choose another system (technical override)"><select className="input" value={override.selectedSystemCode} onChange={(e) => setOverride((o) => ({ ...o, selectedSystemCode: e.target.value }))}><option value="">Use recommendation</option>{result.options.map((o) => <option key={o.systemCode} value={o.systemCode}>{o.systemCode} · {o.systemName}</option>)}</select></Field>
                  <Field label="Override reason (mandatory when different)"><input className="input" value={override.overrideReason} onChange={(e) => setOverride((o) => ({ ...o, overrideReason: e.target.value }))} /></Field>
                </div>
              )} />
          ) : (
            <form onSubmit={saveManual} className="grid grid-cols-3 gap-2">
              <Field label="Battery (kWh)"><input className="input mono" type="number" step="0.1" min={0} value={manual.batteryKwh} onChange={(e) => setManual((m) => ({ ...m, batteryKwh: e.target.value }))} /></Field>
              <Field label="Inverter (kVA)"><input className="input mono" type="number" step="0.1" min={0} value={manual.inverterKva} onChange={(e) => setManual((m) => ({ ...m, inverterKva: e.target.value }))} /></Field>
              <Field label="Solar (kWp)"><input className="input mono" type="number" step="0.1" min={0} value={manual.solarKwp} onChange={(e) => setManual((m) => ({ ...m, solarKwp: e.target.value }))} /></Field>
              <div className="col-span-3"><Field label="Source note (EPC site survey, customer load data …)" hint="No size at all → PENDING_TECHNICAL_DATA (never shown as custom)."><input className="input" required minLength={3} value={manual.sourceNote} onChange={(e) => setManual((m) => ({ ...m, sourceNote: e.target.value }))} /></Field></div>
              <div className="col-span-3 flex justify-end"><button className="btn btn-primary" type="submit" disabled={busy}>Save {mode === "EPC" ? "EPC" : "manual"} assessment</button></div>
            </form>
          )}
        </Card>
      )}
      <Card title="Assessment versions" right="latest is current; older ones kept">
        {(q.data?.data ?? []).length === 0 && <Empty>No assessment yet. S3 cannot complete without one.</Empty>}
        <div className="space-y-2">
          {(q.data?.data ?? []).map((a) => (
            <div key={a.id} className="rounded-lg border border-line p-3 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2"><b>v{a.version}</b><span className="chip bg-chip text-teal">{a.method}</span>{statusChip(a.recommendationStatus)}{a.confirmedAt && <span className="chip bg-navy text-white">confirmed {fmtDateTime(a.confirmedAt)}</span>}<span className="ml-auto text-muted">{fmtDateTime(a.createdAt)}</span></div>
              <dl className="kv mt-2">
                <dt>Recommended</dt><dd className="mono">{a.recommendedCode ?? "—"}</dd>
                <dt>Selected</dt><dd className="mono">{a.selectedCode ?? "—"} {a.overrideReason && <span className="text-warn">· override: {a.overrideReason}</span>}</dd>
                <dt>Steps</dt><dd className="mono text-[11.5px]">{Object.entries(a.result?.steps ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}=${v}`).join(" · ") || "—"}</dd>
                {a.result?.texts?.message && <><dt>Message</dt><dd>{a.result.texts.message}</dd></>}
              </dl>
              {canConfirm && !a.confirmedAt && a.version === latest?.version && <button className="btn btn-primary btn-sm mt-2" type="button" disabled={busy} onClick={() => confirm(a.id)}>Confirm assessment → S4</button>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
