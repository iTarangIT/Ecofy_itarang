"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { fmtDateTime, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, Empty, Field } from "@/components/ui/primitives";
import { Calculator, type CalcResultView } from "@/components/calculator/Calculator";
import { useCaseAction } from "./shared";

type P = { c: CaseSummary; onChange: () => void };
export type Assessment = { id: string; version: number; method: string; releaseId: string | null; recommendationStatus: string; recommendedCode: string | null; selectedCode: string | null; overrideReason: string | null; confirmedAt: string | null; createdAt: string; inputs: Record<string, unknown>; result: CalcResultView & { steps: Record<string, number | null> } };

export const canSaveAssessment = (role: string, stage: string) => (role === "ECOFY_USER" && stage === "S0") || ((role === "ITARANG_CALLER" || role === "ITARANG_ADMIN") && stage !== "CLOSED");

/** M07: calculator or manual/EPC assessment. C&I never shows the calculator (FR-07.11). Renders nothing when not allowed. */
export function NewAssessmentForm({ c, onChange }: P) {
  const s = useSession();
  const { busy, run } = useCaseAction(c.id, onChange, ["assessments"]);
  const [mode, setMode] = useState<"CALCULATOR" | "MANUAL" | "EPC">(c.segment === "CI" ? "EPC" : "CALCULATOR");
  const [manual, setManual] = useState({ batteryKwh: "", inverterKva: "", solarKwp: "", sourceNote: "" });
  const [override, setOverride] = useState({ selectedSystemCode: "", overrideReason: "" });
  if (!canSaveAssessment(s.role, c.stage)) return null;

  async function saveCalc(input: Record<string, unknown>, result: CalcResultView) {
    const rec = result.options.find((o) => o.role === "RECOMMENDED")?.systemCode;
    const sel = override.selectedSystemCode || undefined;
    await run("Assessment saved", () => post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: input, selectedSystemCode: sel, overrideReason: sel && sel !== rec ? override.overrideReason || undefined : undefined }));
  }
  async function saveManual(e: React.FormEvent) {
    e.preventDefault();
    await run("Assessment saved", () => post(`/cases/${c.id}/assessments`, { method: mode, manual: { batteryKwh: manual.batteryKwh ? Number(manual.batteryKwh) : undefined, inverterKva: manual.inverterKva ? Number(manual.inverterKva) : undefined, solarKwp: manual.solarKwp ? Number(manual.solarKwp) : undefined, sourceNote: manual.sourceNote } }));
  }

  return (
    <div>
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
    </div>
  );
}

const statusChip = (st: string) => <span className={`chip ${st === "RECOMMENDED" ? "bg-ecofy-soft text-ecofy" : st === "CUSTOM_REQUIRED" ? "bg-epc-soft text-epc" : "bg-warn-soft text-warn"}`}>{st.replace(/_/g, " ")}</span>;

/** One assessment version; the confirm button when it is the latest, unconfirmed and the case is at S3 (iTarang). */
export function AssessmentCard({ c, a, latest, onChange }: P & { a: Assessment; latest: boolean }) {
  const s = useSession();
  const { busy, run } = useCaseAction(c.id, onChange, ["assessments"]);
  const canConfirm = (s.role === "ITARANG_CALLER" || s.role === "ITARANG_ADMIN") && c.stage === "S3";
  return (
    <div className="rounded-lg border border-line bg-white p-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2"><b>v{a.version}</b><span className="chip bg-chip text-teal">{a.method}</span>{statusChip(a.recommendationStatus)}{a.confirmedAt && <span className="chip bg-navy text-white">confirmed {fmtDateTime(a.confirmedAt)}</span>}<span className="ml-auto text-muted">{fmtDateTime(a.createdAt)}</span></div>
      <dl className="kv mt-2">
        <dt>Recommended</dt><dd className="mono">{a.recommendedCode ?? "—"}</dd>
        <dt>Selected</dt><dd className="mono">{a.selectedCode ?? "—"} {a.overrideReason && <span className="text-warn">· override: {a.overrideReason}</span>}</dd>
        <dt>Steps</dt><dd className="mono text-[11.5px]">{Object.entries(a.result?.steps ?? {}).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => `${k}=${v}`).join(" · ") || "—"}</dd>
        {a.result?.texts?.message && <><dt>Message</dt><dd>{a.result.texts.message}</dd></>}
      </dl>
      {canConfirm && !a.confirmedAt && latest && (
        <button className="btn btn-primary btn-sm mt-2" type="button" disabled={busy} onClick={() => run("Assessment confirmed — case at S4", () => post(`/assessments/${a.id}/confirm`, undefined, { ifMatch: c.version }))}>
          Confirm assessment → S4
        </button>
      )}
    </div>
  );
}

export function AssessmentTab({ c, onChange }: P) {
  const s = useSession();
  const q = useQuery({ queryKey: ["assessments", c.id], queryFn: () => get<Assessment[]>(`/cases/${c.id}/assessments`) });
  const latest = q.data?.data[0];
  return (
    <div className="space-y-4">
      {canSaveAssessment(s.role, c.stage) && (
        <Card title="New assessment" right={c.segment === "CI" ? "C&I: EPC quote required — calculator off" : `latest version ${latest?.version ?? 0}`}>
          <NewAssessmentForm c={c} onChange={onChange} />
        </Card>
      )}
      <Card title="Assessment versions" right="latest is current; older ones kept">
        {(q.data?.data ?? []).length === 0 && <Empty>No assessment yet. S3 cannot complete without one.</Empty>}
        <div className="space-y-2">
          {(q.data?.data ?? []).map((a) => <AssessmentCard key={a.id} c={c} a={a} latest={a.version === latest?.version} onChange={onChange} />)}
        </div>
      </Card>
    </div>
  );
}
