"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, patch, put, uploadDocument, errorMessage } from "@/lib/api";
import { Banner, Card, Empty } from "@/components/ui/primitives";
import { FilePicker } from "@/components/ui/file-picker";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/Shell";
import { Calculator } from "@/components/calculator/Calculator";
import { fmtDateTime } from "@/lib/hooks";

type Release = { id: string; version: number; status: string; changeNote: string | null; decisionNote: string | null; createdAt: string; publishedAt: string | null; submittedAt: string | null };
type Bundle = Release & { params: Record<string, unknown>; appliances: Array<{ name: string; defaultWatts: number; isMotor: boolean; startMultiplier: number; sortOrder: number; active?: boolean }>; systems: Array<Record<string, unknown> & { systemCode: string; systemName: string; systemType: string; phase: string; usableCapacityKwh: number; inverterKva: number; solarKwp: number; equipmentPriceMinInr: number; equipmentPriceMaxInr: number; installationPriceMinInr: number; installationPriceMaxInr: number; gstPct: number; priceUpdatedOn: string; active: boolean }> };

/** M08: iTarang Admin edits values/lists/rules/texts inside the fixed 9-step formula; Ecofy Admin approves. */
export default function DesignerPage() {
  const s = useSession();
  const qc = useQueryClient();
  const canEdit = s.role === "ITARANG_ADMIN";
  const canApprove = s.role === "ECOFY_ADMIN";
  const list = useQuery({ queryKey: ["releases"], queryFn: () => get<Release[]>("/calculator/releases") });
  const [sel, setSel] = useState<string | null>(null);
  const current = sel ?? list.data?.data.find((r) => r.status === "DRAFT" || r.status === "PENDING_APPROVAL")?.id ?? list.data?.data.find((r) => r.status === "PUBLISHED")?.id ?? null;
  const bundle = useQuery({ queryKey: ["release", current], queryFn: () => get<Bundle>(`/calculator/releases/${current}`), enabled: Boolean(current) });
  const b = bundle.data?.data;
  const [paramsText, setParamsText] = useState<string | null>(null);
  const [tab, setTab] = useState<"Values & rules" | "Appliances" | "Standard systems" | "Test bench">("Values & rules");
  const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["releases"] }); qc.invalidateQueries({ queryKey: ["release"] }); setParamsText(null); };
  const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); toast(label); refresh(); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); } };
  const isDraft = b?.status === "DRAFT";

  return (
    <div className="space-y-4">
      <Banner>The 9-step formula is fixed (FR-08.8). iTarang Admin edits values, segments, input methods, appliances, recommendation rules, display texts and the standard systems in a <b>draft</b>; the test bench shows every step; Ecofy Admin approves (publishes, retiring the previous release) or rejects with a note. Every assessment stores the release it used.</Banner>
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card title="Releases" right={canEdit && !list.data?.data.some((r) => r.status === "DRAFT" || r.status === "PENDING_APPROVAL") ? <button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => { const n = window.prompt("Change note for the new draft"); if (n) run("Draft created", () => post("/calculator/releases", { changeNote: n })); }}>+ Draft</button> : undefined} pad={false}>
          {(list.data?.data ?? []).map((r) => (
            <button key={r.id} type="button" className={`block w-full border-b border-line px-4 py-2 text-left text-[12.5px] hover:bg-page ${current === r.id ? "bg-sky-soft" : ""}`} onClick={() => { setSel(r.id); setParamsText(null); }}>
              <div className="flex items-center gap-2"><b>v{r.version}</b><span className={`chip ${r.status === "PUBLISHED" ? "bg-ecofy-soft text-ecofy" : r.status === "DRAFT" ? "bg-sky-soft text-sky" : r.status === "PENDING_APPROVAL" ? "bg-warn-soft text-warn" : "bg-chip text-muted"}`}>{r.status}</span></div>
              <div className="text-muted">{r.changeNote}</div>
            </button>
          ))}
          {list.data && list.data.data.length === 0 && <Empty>No releases.</Empty>}
        </Card>
        <div className="space-y-4">
          {b && (
            <Card title={`Release v${b.version} — ${b.status}`} right={<span className="flex flex-wrap gap-1">
              {canEdit && isDraft && <button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => { const n = window.prompt("Note for Ecofy (optional)") ?? ""; run("Submitted for Ecofy approval", () => post(`/calculator/releases/${b.id}/submit`, { note: n || undefined })); }}>Submit for approval</button>}
              {canApprove && b.status === "PENDING_APPROVAL" && <><button className="btn btn-sm btn-green" type="button" disabled={busy} onClick={() => { const n = window.prompt("Approval note (optional)") ?? ""; run("Published", () => post(`/calculator/releases/${b.id}/approve`, { note: n || undefined })); }}>Approve & publish</button><button className="btn btn-sm btn-danger" type="button" disabled={busy} onClick={() => { const n = window.prompt("Rejection note (required)"); if (n) run("Rejected — back to draft", () => post(`/calculator/releases/${b.id}/reject`, { note: n })); }}>Reject</button></>}
              {canEdit && (b.status === "RETIRED" || b.status === "PUBLISHED" || b.status === "REJECTED") && <button className="btn btn-sm" type="button" disabled={busy} onClick={() => { const n = window.prompt("Change note for the restored draft"); if (n) run("Copied into a new draft", () => post(`/calculator/releases/${b.id}/restore`, { changeNote: n })); }}>Restore as draft</button>}
            </span>}>
              <div className="text-[12.5px] text-muted">{b.changeNote} · created {fmtDateTime(b.createdAt)}{b.publishedAt ? ` · published ${fmtDateTime(b.publishedAt)}` : ""}{b.decisionNote ? ` · decision: ${b.decisionNote}` : ""}</div>
              <div className="mt-3 flex flex-wrap gap-1">{(["Values & rules", "Appliances", "Standard systems", "Test bench"] as const).map((t) => <button key={t} type="button" className={`btn btn-sm ${tab === t ? "btn-navy" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>
            </Card>
          )}
          {b && tab === "Values & rules" && (
            <Card title="Values, segments, input methods, rules, display, texts (JSON)" right="formula: FIXED_9_STEP_V1">
              <textarea className="input mono h-[420px] text-[12px]" readOnly={!canEdit || !isDraft} value={paramsText ?? JSON.stringify(b.params, null, 2)} onChange={(e) => setParamsText(e.target.value)} />
              {canEdit && isDraft && <div className="mt-2 flex justify-end gap-2"><button className="btn" type="button" onClick={() => setParamsText(null)}>Discard</button><button className="btn btn-primary" type="button" disabled={busy || paramsText === null} onClick={() => run("Draft saved", () => patch(`/calculator/releases/${b.id}`, { params: JSON.parse(paramsText!) }))}>Save draft</button></div>}
            </Card>
          )}
          {b && tab === "Appliances" && <AppliancesEditor b={b} canEdit={canEdit && isDraft} run={run} busy={busy} />}
          {b && tab === "Standard systems" && <SystemsEditor b={b} canEdit={canEdit && isDraft} run={run} busy={busy} />}
          {b && tab === "Test bench" && <Card title={`Test bench — every step against v${b.version}`} right="the worked example is preloaded"><Calculator segment="RESI" releaseId={b.id} defaults={{ monthlyUnits: 300 }} /></Card>}
        </div>
      </div>
    </div>
  );
}

function AppliancesEditor({ b, canEdit, run, busy }: { b: Bundle; canEdit: boolean; run: (l: string, f: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [rows, setRows] = useState(b.appliances.map((a) => ({ ...a, active: a.active ?? true })));
  return (
    <Card title="Appliances (watts, motor flag, starting multiplier)" right={canEdit ? <button className="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => run("Appliances saved", () => put(`/calculator/releases/${b.id}/appliances`, rows.map((r, i) => ({ name: r.name, defaultWatts: Number(r.defaultWatts), isMotor: r.isMotor, startMultiplier: Number(r.startMultiplier), sortOrder: i + 1, active: r.active }))))}>Save</button> : undefined} pad={false}>
      <table className="w-full"><thead><tr><th className="th">Name</th><th className="th">Watts</th><th className="th">Motor</th><th className="th">Start ×</th><th className="th">Active</th><th className="th" /></tr></thead><tbody>
        {rows.map((r, i) => (
          <tr key={i}><td className="td"><input className="input" disabled={!canEdit} value={r.name} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} /></td><td className="td"><input className="input mono w-24" type="number" disabled={!canEdit} value={r.defaultWatts} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, defaultWatts: Number(e.target.value) } : y)))} /></td><td className="td"><input type="checkbox" disabled={!canEdit} checked={r.isMotor} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, isMotor: e.target.checked } : y)))} /></td><td className="td"><input className="input mono w-20" type="number" step="0.5" min={1} max={8} disabled={!canEdit} value={r.startMultiplier} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, startMultiplier: Number(e.target.value) } : y)))} /></td><td className="td"><input type="checkbox" disabled={!canEdit} checked={r.active} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, active: e.target.checked } : y)))} /></td><td className="td">{canEdit && <button type="button" className="text-bad" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button>}</td></tr>
        ))}
      </tbody></table>
      {canEdit && <div className="px-4 py-3"><button className="btn btn-sm" type="button" onClick={() => setRows((x) => [...x, { name: "", defaultWatts: 100, isMotor: false, startMultiplier: 1, sortOrder: x.length + 1, active: true }])}>+ Appliance</button></div>}
    </Card>
  );
}

function SystemsEditor({ b, canEdit, run, busy }: { b: Bundle; canEdit: boolean; run: (l: string, f: () => Promise<unknown>) => Promise<void>; busy: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [replaceAll, setReplaceAll] = useState(false);
  const [rejected, setRejected] = useState<Array<{ rowNo: number; code: string; reason: string }>>([]);
  const inr = (v: number) => `₹${v.toLocaleString("en-IN")}`;
  async function importFile() {
    if (!file) return;
    await run("Systems imported", async () => {
      // the template is uploaded as a case-less document: use the first case-independent path — documents need a case, so upload against the designer via the import endpoint's documentId (any committed document of the tenant visible to IA)
      const anyCase = await get<Array<{ id: string }>>("/cases?limit=1");
      if (!anyCase.data.length) throw new Error("Upload needs at least one case to attach the template file to (V1 limitation)");
      const doc = await uploadDocument(anyCase.data[0].id, file, "OTHER");
      const r = await post<{ imported: number; rejected: Array<{ rowNo: number; code: string; reason: string }> }>(`/calculator/releases/${b.id}/systems/import`, { documentId: doc.id, replaceAll });
      setRejected(r.data.rejected);
      if (r.data.rejected.length) toast(`${r.data.rejected.length} rows rejected — see reasons`, "warn");
    });
  }
  return (
    <div className="space-y-4">
      <Card title={`Standard systems (${b.systems.length})`} right="prices are indicative ranges incl. iTarang's margin; retire with active=N, never delete" pad={false}>
        <table className="w-full text-[12px]"><thead><tr><th className="th">Code</th><th className="th">Name</th><th className="th">Type / phase</th><th className="th">Usable kWh</th><th className="th">kVA</th><th className="th">kWp</th><th className="th">Equipment</th><th className="th">Installation</th><th className="th">GST</th><th className="th">Price date</th><th className="th">Active</th></tr></thead><tbody>
          {b.systems.map((sys) => <tr key={sys.systemCode} className={sys.active ? "" : "opacity-50"}><td className="td mono">{sys.systemCode}</td><td className="td">{sys.systemName}</td><td className="td">{sys.systemType} · {sys.phase}</td><td className="td mono">{sys.usableCapacityKwh}</td><td className="td mono">{sys.inverterKva}</td><td className="td mono">{sys.solarKwp}</td><td className="td mono">{inr(sys.equipmentPriceMinInr)}–{inr(sys.equipmentPriceMaxInr)}</td><td className="td mono">{inr(sys.installationPriceMinInr)}–{inr(sys.installationPriceMaxInr)}</td><td className="td mono">{sys.gstPct}%</td><td className="td mono">{sys.priceUpdatedOn}</td><td className="td">{sys.active ? "Y" : "N"}</td></tr>)}
        </tbody></table>
        {b.systems.length === 0 && <Empty>No standard systems in this release. Import the standard systems template v0.2.</Empty>}
      </Card>
      {canEdit && (
        <Card title="Import standard systems (template v0.2)" right={<a className="text-sky" href="/templates/Ecofy_Standard_Systems_Template_v0.2.xlsx">download template</a>}>
          <div className="flex flex-wrap items-end gap-3">
            <FilePicker compact file={file} onChange={setFile} hint="template v0.2 (.xlsx or .csv)" />
            <label className="flex items-center gap-1 text-[12.5px]"><input type="checkbox" checked={replaceAll} onChange={(e) => setReplaceAll(e.target.checked)} /> Replace all rows</label>
            <button className="btn btn-primary btn-sm" type="button" disabled={busy || !file} onClick={importFile}>Import</button>
          </div>
          {rejected.length > 0 && <div className="mt-3 max-h-[200px] overflow-y-auto rounded-lg bg-page p-2 text-[12px]">{rejected.map((r, i) => <div key={i}><span className="mono">row {r.rowNo}</span> {r.code}: {r.reason}</div>)}</div>}
        </Card>
      )}
    </div>
  );
}
