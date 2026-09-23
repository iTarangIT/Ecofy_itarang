"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { Field } from "@/components/ui/primitives";

export type CalcResultView = { releaseVersion: number; recommendationStatus: string; steps: Record<string, number | null>; options: Array<{ systemCode: string; systemName: string; role: string; systemType: string; phase: string; usableCapacityKwh: number; inverterKva: number; solarKwp: number; priceRange: { equipmentMin: number; equipmentMax: number; installationMin: number; installationMax: number; gstPct: number; totalMin: number; totalMax: number } }>; texts: { disclaimer: string; financingLine: string; message: string | null }; pending: string[] };
type Release = { id: string; version: number; status: string; appliances: Array<{ name: string; defaultWatts: number; isMotor: boolean }>; params: { segments: Record<string, { enabled: boolean; inputs?: string[] }> } };
type Line = { applianceName: string; watts: number; quantity: number };

const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;
const STEP_LABEL: Record<string, string> = { running_load_kw: "Running load (kW)", backup_energy_kwh: "Backup energy (kWh)", usable_battery_needed_kwh: "Usable battery needed (kWh)", battery_size_kwh: "Battery size shown (kWh)", motor_start_kw: "Motor starting power (kW)", required_inverter_kva: "Inverter size (kVA)", solar_kwp: "Solar size (kWp)" };

/**
 * The energy calculator UI (FR-07.1 … FR-07.7): live estimate against the published release,
 * appliance list or bill inputs, backup hours + phase always asked, three outcomes, ranges only.
 */
export function Calculator({ segment, defaults = {}, onSave, saving, extra, releaseId, title }: { segment: "RESI" | "ESS" | "CI"; defaults?: { productInterest?: string; monthlyUnits?: number; sanctionedLoadKw?: number }; onSave?: (input: Record<string, unknown>, result: CalcResultView) => void; saving?: boolean; extra?: (result: CalcResultView) => ReactNode; releaseId?: string; title?: string }) {
  const releases = useQuery({ queryKey: ["releases"], queryFn: () => get<Array<{ id: string; version: number; status: string }>>("/calculator/releases"), enabled: !releaseId });
  const pubId = releaseId ?? releases.data?.data.find((r) => r.status === "PUBLISHED")?.id;
  const rel = useQuery({ queryKey: ["release", pubId], queryFn: () => get<Release>(`/calculator/releases/${pubId}`), enabled: Boolean(pubId), staleTime: 300_000 });
  const appliances = useMemo(() => rel.data?.data.appliances ?? [], [rel.data]);
  const [method, setMethod] = useState<"APPLIANCES" | "MONTHLY_UNITS" | "RUNNING_LOAD" | "NONE">("APPLIANCES");
  const [linesState, setLines] = useState<Line[] | null>(null);
  const [add, setAdd] = useState("");
  const [f, setF] = useState({ productInterest: defaults.productInterest ?? "SOLAR_STORAGE", monthlyUnits: defaults.monthlyUnits?.toString() ?? "", runningLoadKw: "", sanctionedLoadKw: defaults.sanctionedLoadKw?.toString() ?? "", backupHours: "4", phase: "SINGLE" });
  const [result, setResult] = useState<CalcResultView | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Until the user edits the list, show a typical household from the release's appliance catalogue.
  const lines = useMemo<Line[]>(() => {
    if (linesState) return linesState;
    const pick = (n: string, q: number) => { const a = appliances.find((x) => x.name === n); return a ? { applianceName: a.name, watts: a.defaultWatts, quantity: q } : null; };
    return [pick("Ceiling fan", 4), pick("LED bulb", 6), pick("Television", 1), pick("Refrigerator", 1)].filter(Boolean) as Line[];
  }, [linesState, appliances]);
  const updateLines = (fn: (ls: Line[]) => Line[]) => setLines(fn(lines));

  const input = useMemo(() => ({
    segment, productInterest: f.productInterest, method, appliances: method === "APPLIANCES" ? lines : undefined,
    monthlyUnits: f.monthlyUnits ? Number(f.monthlyUnits) : undefined, runningLoadKw: method === "RUNNING_LOAD" && f.runningLoadKw ? Number(f.runningLoadKw) : undefined,
    sanctionedLoadKw: f.sanctionedLoadKw ? Number(f.sanctionedLoadKw) : undefined, backupHours: f.productInterest === "SOLAR_ONLY" ? undefined : Number(f.backupHours || 0), phase: f.phase,
  }), [segment, f, method, lines]);

  useEffect(() => {
    if (segment === "CI") return;
    const t = setTimeout(async () => {
      try {
        const r = await post<CalcResultView>(releaseId ? `/calculator/releases/${releaseId}/test` : "/calculator/estimate", input);
        setResult(r.data); setErr(null);
      } catch (e) { setErr(errorMessage(e)); }
    }, 350);
    return () => clearTimeout(t);
  }, [input, segment, releaseId]);

  if (segment === "CI") return <div className="banner banner-amber">C&amp;I: the calculator is off. <b>EPC quote required</b> — record a manual or EPC assessment.</div>;
  const segCfg = rel.data?.data.params.segments?.[segment];
  const inputs = segCfg?.inputs ?? ["APPLIANCES", "MONTHLY_UNITS"];
  const rec = result?.options.find((o) => o.role === "RECOMMENDED");

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-3">
        {title && <div className="text-[13.5px] font-semibold">{title}</div>}
        <div className="flex gap-1">
          {inputs.map((m) => <button key={m} type="button" className={`btn btn-sm ${method === m ? "btn-navy" : ""}`} onClick={() => setMethod(m as never)}>{m === "APPLIANCES" ? "Appliance list" : m === "MONTHLY_UNITS" ? "Monthly units (bill)" : "Running load"}</button>)}
        </div>
        {method === "APPLIANCES" && (
          <div className="rounded-lg border border-line">
            <div className="grid grid-cols-[1.6fr_.8fr_.8fr_.9fr_34px] gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted"><span>Appliance</span><span>Watts</span><span>Qty</span><span>Load</span><span /></div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1.6fr_.8fr_.8fr_.9fr_34px] items-center gap-2 border-t border-line px-3 py-1.5 text-[13px]">
                <span>{l.applianceName}{appliances.find((a) => a.name === l.applianceName)?.isMotor && <span className="ml-1 text-[10.5px] text-warn">motor</span>}</span>
                <input className="input mono" type="number" min={1} value={l.watts} onChange={(e) => updateLines((x) => x.map((y, j) => (j === i ? { ...y, watts: Number(e.target.value) } : y)))} />
                <input className="input mono" type="number" min={1} value={l.quantity} onChange={(e) => updateLines((x) => x.map((y, j) => (j === i ? { ...y, quantity: Number(e.target.value) } : y)))} />
                <span className="mono">{l.watts * l.quantity} W</span>
                <button type="button" className="text-muted hover:text-bad" onClick={() => updateLines((x) => x.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div className="flex items-center gap-2 border-t border-line px-3 py-2">
              <select className="input" value={add} onChange={(e) => setAdd(e.target.value)}><option value="">Add appliance…</option>{appliances.map((a) => <option key={a.name} value={a.name}>{a.name} ({a.defaultWatts} W)</option>)}</select>
              <button type="button" className="btn btn-sm" onClick={() => { const a = appliances.find((x) => x.name === add); if (a) { updateLines((x) => [...x, { applianceName: a.name, watts: a.defaultWatts, quantity: 1 }]); setAdd(""); } }}>+ Add</button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {method === "RUNNING_LOAD" && <Field label="Running load (kW)"><input className="input mono" type="number" step="0.1" min={0} value={f.runningLoadKw} onChange={(e) => setF((x) => ({ ...x, runningLoadKw: e.target.value }))} /></Field>}
          <Field label="Monthly units (from bill)" hint={method === "MONTHLY_UNITS" ? "Bill-only sizing uses the sanctioned load for power." : "Needed for the solar step."}><input className="input mono" type="number" min={0} value={f.monthlyUnits} onChange={(e) => setF((x) => ({ ...x, monthlyUnits: e.target.value }))} /></Field>
          {method === "MONTHLY_UNITS" && <Field label="Sanctioned load (kW)"><input className="input mono" type="number" step="0.1" min={0} value={f.sanctionedLoadKw} onChange={(e) => setF((x) => ({ ...x, sanctionedLoadKw: e.target.value }))} /></Field>}
          <Field label="Product interest"><select className="input" value={f.productInterest} onChange={(e) => setF((x) => ({ ...x, productInterest: e.target.value }))}><option value="SOLAR_STORAGE">Solar + storage</option><option value="STORAGE_ONLY">Storage only</option><option value="SOLAR_ONLY">Solar only</option><option value="NOT_SURE">Not sure</option></select></Field>
          {f.productInterest !== "SOLAR_ONLY" && <Field label="Backup required (hours)"><input className="input mono" type="number" min={0} max={24} value={f.backupHours} onChange={(e) => setF((x) => ({ ...x, backupHours: e.target.value }))} /></Field>}
          <Field label="Phase"><select className="input" value={f.phase} onChange={(e) => setF((x) => ({ ...x, phase: e.target.value }))}><option value="SINGLE">Single</option><option value="THREE">Three</option></select></Field>
        </div>
        <p className="text-[11.5px] text-muted">{result?.texts.disclaimer ?? "Indicative price range. The final price comes from the EPC partner's quote."} Release v{result?.releaseVersion ?? "—"}.</p>
      </div>
      <div className="space-y-3">
        {err && <div className="banner banner-red">{err}</div>}
        <div className="rounded-[10px] bg-gradient-to-br from-navy to-[#0a4a6e] p-4 text-white">
          <div className="text-[11px] uppercase tracking-wider opacity-80">Recommended battery size</div>
          <div className="text-[32px] font-bold leading-none">{result?.steps.battery_size_kwh ?? "—"} <span className="text-[14px] font-normal">kWh</span></div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            {Object.entries(STEP_LABEL).filter(([k]) => k !== "battery_size_kwh").map(([k, label]) => (
              <div key={k} className="rounded-lg bg-white/10 px-2.5 py-1.5"><div className="opacity-75">{label}</div><div className="mono text-[15px]">{result?.steps[k] ?? "—"}</div></div>
            ))}
          </div>
        </div>
        {result && result.recommendationStatus !== "RECOMMENDED" && <div className={`banner ${result.recommendationStatus === "PENDING_TECHNICAL_DATA" ? "banner-amber" : "banner-purple"}`}><b>{result.recommendationStatus.replace(/_/g, " ")}.</b> {result.texts.message}{result.pending.length ? ` (missing: ${result.pending.join(", ")})` : ""}</div>}
        {result && result.options.length > 0 && (
          <div className="space-y-1.5">
            {result.options.map((o) => (
              <div key={o.systemCode} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${o.role === "RECOMMENDED" ? "border-sky bg-[#f4fafd]" : "border-line"}`}>
                <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded bg-navy text-white"><span className="mono text-[13px] font-bold">{o.usableCapacityKwh}</span><span className="text-[9px]">kWh</span></div>
                <div className="flex-1 text-[12.5px]"><div className="font-semibold">{o.systemName} {o.role === "RECOMMENDED" && <span className="chip bg-sky-soft text-sky">RECOMMENDED</span>}{o.role !== "RECOMMENDED" && <span className="chip bg-chip text-muted">{o.role}</span>}</div><div className="text-muted">{o.inverterKva} kVA · {o.solarKwp} kWp · {o.phase.toLowerCase()} phase · {o.systemType.replace("_", " ").toLowerCase()}</div></div>
                <div className="text-right text-[12px]"><div className="mono font-semibold">{inr(o.priceRange.totalMin)}–{inr(o.priceRange.totalMax)}</div><div className="text-muted">equipment {inr(o.priceRange.equipmentMin)}–{inr(o.priceRange.equipmentMax)}</div><div className="text-muted">install {inr(o.priceRange.installationMin)}–{inr(o.priceRange.installationMax)} · GST {o.priceRange.gstPct}%</div></div>
              </div>
            ))}
            <p className="text-[11.5px] text-muted">{result.texts.financingLine} No EMI is shown.</p>
          </div>
        )}
        {result && extra && extra(result)}
        {onSave && result && <button className="btn btn-primary" type="button" disabled={saving} onClick={() => onSave(input, result)}>{saving ? "Saving…" : "Save assessment to case"}</button>}
        {rec && <p className="text-[11.5px] text-muted">Smallest active system for the segment, phase and type that covers the need, with one smaller and one larger alternative.</p>}
      </div>
    </div>
  );
}
