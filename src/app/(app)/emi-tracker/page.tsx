"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { Banner, Card, Empty, Field, Kpi, Modal } from "@/components/ui/primitives";
import { FilePicker } from "@/components/ui/file-picker";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/Shell";
import { fmtDate, fmtDateTime, todayIso } from "@/lib/hooks";

type EmiState = "CURRENT" | "DPD_1_30" | "DPD_31_60" | "DPD_61_90" | "DPD_90_PLUS" | "CLOSED";
type Row = {
  assetId: string; caseId: string; caseNo: string; fileNo: string | null; customerName: string; city: string | null; system: string | null; commissionedOn: string; assetStatus: string;
  emi: { asOf: string; state: EmiState; note: string | null; recordedAt: string } | null;
  previous: { asOf: string; state: EmiState } | null;
  updates: number;
};
type UploadResult = { fileName: string; total: number; applied: number; failed: number; errors: Array<{ row: number; caseNo: string; fileNo: string; code: string; message: string }> };

const STATES: EmiState[] = ["CURRENT", "DPD_1_30", "DPD_31_60", "DPD_61_90", "DPD_90_PLUS", "CLOSED"];
const LIFECYCLES = ["ACTIVE", "BUYBACK", "REDEPLOYED", "CLOSED"];
const label = (st?: string | null) => (st ? st.replace(/_PLUS$/, "+").replace(/^DPD_/, "DPD ").replace(/_/g, "–") : "no EMI status");
const chipCls = (st?: string | null) => !st ? "bg-chip text-muted" : st === "CURRENT" ? "bg-ecofy-soft text-ecofy" : st === "CLOSED" ? "bg-navy text-white" : st === "DPD_1_30" || st === "DPD_31_60" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad";
const EmiChip = ({ st }: { st?: string | null }) => <span className={`chip ${chipCls(st)}`}>{label(st)}</span>;

const EMPTY = { q: "", state: "", status: "", asOfFrom: "", asOfTo: "", city: "" };

function toQuery(f: typeof EMPTY) {
  const p = new URLSearchParams();
  (Object.keys(f) as Array<keyof typeof EMPTY>).forEach((k) => { if (f[k]) p.set(k, f[k]); });
  return p.toString();
}

async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** CONFLICTS #32: EMI tracker — every financed asset with its latest EMI status; Ecofy Admin updates one lead or uploads a sheet; CSV download honours the filters. */
export default function EmiTrackerPage() {
  const s = useSession();
  const qc = useQueryClient();
  const isEa = s.role === "ECOFY_ADMIN";
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const qs = useMemo(() => toQuery(filters), [filters]);
  const q = useQuery({ queryKey: ["emi-tracker", qs], queryFn: () => get<Row[]>(`/emi-tracker${qs ? `?${qs}` : ""}`) });
  const rows = useMemo(() => q.data?.data ?? [], [q.data]);

  const [sel, setSel] = useState<Row | null>(null);
  const [emi, setEmi] = useState({ asOf: todayIso(), state: "CURRENT" as EmiState, note: "" });
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  const counts = useMemo(() => {
    const c: Record<string, number> = { NONE: 0 };
    STATES.forEach((st) => (c[st] = 0));
    rows.forEach((r) => { c[r.emi?.state ?? "NONE"] = (c[r.emi?.state ?? "NONE"] ?? 0) + 1; });
    return c;
  }, [rows]);
  const overdue = counts.DPD_1_30! + counts.DPD_31_60! + counts.DPD_61_90! + counts.DPD_90_PLUS!;

  const refresh = () => { qc.invalidateQueries({ queryKey: ["emi-tracker"] }); qc.invalidateQueries({ queryKey: ["assets"] }); };
  const apply = () => setFilters({ ...draft });
  const clear = () => { setDraft(EMPTY); setFilters(EMPTY); };
  const openUpdate = (r: Row) => { setSel(r); setEmi({ asOf: todayIso(), state: r.emi?.state ?? "CURRENT", note: "" }); };

  async function recordOne() {
    if (!sel) return;
    setBusy(true);
    try {
      await post(`/assets/${sel.assetId}/emi-status`, { asOf: emi.asOf, state: emi.state, note: emi.note || undefined });
      toast(`EMI status recorded for ${sel.caseNo}`);
      setSel(null);
      refresh();
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await post<UploadResult>("/emi-tracker/upload", { fileName: file.name, contentBase64: await fileToBase64(file) });
      setResult(r.data);
      toast(r.data.failed ? `${r.data.applied} applied, ${r.data.failed} rejected` : `${r.data.applied} EMI updates applied`, r.data.failed ? "bad" : undefined);
      setFile(null);
      refresh();
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }

  const exportHref = (scope: "latest" | "history") => `/api/v1/emi-tracker/export.csv?${qs ? `${qs}&` : ""}scope=${scope}`;

  return (
    <div className="space-y-4">
      <Banner>EMI tracker: every financed, installed system with the latest EMI status (days-past-due band) Ecofy Admin has recorded under Ecofy&apos;s own policy. Update one lead from its row, or upload a sheet of updates for many leads at once. The CSV download follows the filters. No IoT data and no risk flag in V1.</Banner>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Assets shown" value={rows.length} sub={q.isFetching ? "refreshing…" : `${counts.NONE} without an EMI status`} />
        <Kpi label="Current" value={counts.CURRENT} sub="paying on time" />
        <Kpi label="Overdue (any DPD)" value={overdue} sub={`${counts.DPD_1_30} · ${counts.DPD_31_60} · ${counts.DPD_61_90} · ${counts.DPD_90_PLUS} by band`} />
        <Kpi label="90+ days" value={counts.DPD_90_PLUS} sub="needs Ecofy's attention" />
        <Kpi label="Closed loans" value={counts.CLOSED} sub="EMI schedule complete" />
      </div>

      <Card title="Filters" right={<button className="text-sky" type="button" onClick={clear}>Clear</button>}>
        <form className="grid gap-3 md:grid-cols-3 lg:grid-cols-6" onSubmit={(e) => { e.preventDefault(); apply(); }}>
          <Field label="Search"><input className="input" placeholder="Case, File or customer" value={draft.q} onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))} /></Field>
          <Field label="EMI status">
            <select className="input" value={draft.state} onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))}>
              <option value="">All</option>
              <option value="NONE">No EMI status yet</option>
              <option value="DPD_1_30,DPD_31_60,DPD_61_90,DPD_90_PLUS">Any overdue (DPD)</option>
              {STATES.map((st) => <option key={st} value={st}>{label(st)}</option>)}
            </select>
          </Field>
          <Field label="Lifecycle">
            <select className="input" value={draft.status} onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value }))}>
              <option value="">All</option>
              {LIFECYCLES.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </Field>
          <Field label="As of — from"><input className="input" type="date" value={draft.asOfFrom} onChange={(e) => setDraft((d) => ({ ...d, asOfFrom: e.target.value }))} /></Field>
          <Field label="As of — to"><input className="input" type="date" value={draft.asOfTo} onChange={(e) => setDraft((d) => ({ ...d, asOfTo: e.target.value }))} /></Field>
          <Field label="City"><input className="input" placeholder="e.g. Pune" value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} /></Field>
          <div className="flex flex-wrap items-center gap-2 md:col-span-3 lg:col-span-6">
            <button className="btn btn-primary btn-sm" type="submit">Apply filters</button>
            <span className="text-[12px] text-muted">{rows.length} asset{rows.length === 1 ? "" : "s"} match</span>
            <div className="ml-auto flex flex-wrap gap-2">
              <a className="btn btn-sm" href={exportHref("latest")}>⬇ Download CSV</a>
              <a className="btn btn-sm" href={exportHref("history")} title="Every EMI status ever recorded for the filtered assets">⬇ Download history CSV</a>
              {isEa && <button className="btn btn-green btn-sm" type="button" onClick={() => { setResult(null); setUploadOpen(true); }}>⬆ Upload EMI updates</button>}
            </div>
          </div>
        </form>
      </Card>

      <Card title={`EMI status by lead (${rows.length})`} pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full"><thead><tr><th className="th">Case / File</th><th className="th">Customer</th><th className="th">System</th><th className="th">Commissioned</th><th className="th">EMI status</th><th className="th">Previous</th><th className="th">Note</th><th className="th">Lifecycle</th><th className="th">Recorded</th><th className="th" /></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.assetId}>
                <td className="td"><Link className="mono text-sky" href={`/cases/${r.caseId}`}>{r.caseNo}</Link><div className="mono text-[11.5px] text-muted">{r.fileNo}</div></td>
                <td className="td">{r.customerName}<div className="text-[12px] text-muted">{r.city}</div></td>
                <td className="td text-[12.5px]">{r.system}</td>
                <td className="td text-[12px]">{fmtDate(r.commissionedOn)}</td>
                <td className="td"><EmiChip st={r.emi?.state} />{r.emi && <div className="text-[11px] text-muted">as of {r.emi.asOf}</div>}</td>
                <td className="td text-[12px] text-muted">{r.previous ? <>{label(r.previous.state)}<div className="text-[11px]">{r.previous.asOf}</div></> : "—"}{r.updates > 2 && <div className="text-[11px]">{r.updates} updates</div>}</td>
                <td className="td max-w-[220px] truncate text-[12px] text-muted" title={r.emi?.note ?? ""}>{r.emi?.note ?? "—"}</td>
                <td className="td"><span className={`chip ${r.assetStatus === "ACTIVE" ? "bg-ecofy-soft text-ecofy" : "bg-chip text-muted"}`}>{r.assetStatus}</span></td>
                <td className="td text-[11.5px] text-muted">{r.emi ? fmtDateTime(r.emi.recordedAt) : "—"}</td>
                <td className="td text-right">{isEa && <button className="btn btn-sm" type="button" onClick={() => openUpdate(r)}>Update</button>}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
        {q.isLoading && <Empty>Loading…</Empty>}
        {q.data && rows.length === 0 && <Empty>{qs ? "No assets match these filters." : "No assets yet — assets are created when a disbursement is recorded."}</Empty>}
      </Card>

      <Modal open={Boolean(sel)} onClose={() => setSel(null)} title={`EMI status — ${sel?.caseNo}`}>
        {sel && (
          <div className="space-y-3">
            <div className="text-[12.5px] text-muted">{sel.customerName} · {sel.system} · latest: <EmiChip st={sel.emi?.state} /> {sel.emi && <span>as of {sel.emi.asOf}</span>}</div>
            <Field label="As of"><input className="input" type="date" value={emi.asOf} onChange={(e) => setEmi((x) => ({ ...x, asOf: e.target.value }))} /></Field>
            <Field label="State (DPD band)"><select className="input" value={emi.state} onChange={(e) => setEmi((x) => ({ ...x, state: e.target.value as EmiState }))}>{STATES.map((st) => <option key={st} value={st}>{label(st)}</option>)}</select></Field>
            <Field label="Note"><input className="input" value={emi.note} onChange={(e) => setEmi((x) => ({ ...x, note: e.target.value }))} /></Field>
            <div className="flex justify-end gap-2">
              <button className="btn btn-sm" type="button" onClick={() => setSel(null)}>Cancel</button>
              <button className="btn btn-green btn-sm" type="button" disabled={busy} onClick={recordOne}>Record EMI status</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload EMI updates" wide>
        <div className="space-y-3">
          <div className="text-[12.5px] text-muted">
            One row per lead: <span className="mono">case_no</span> (or <span className="mono">file_no</span>), <span className="mono">as_of</span> (YYYY-MM-DD or DD-MM-YYYY), <span className="mono">state</span> (CURRENT, DPD_1_30, DPD_31_60, DPD_61_90, DPD_90_PLUS, CLOSED) and an optional <span className="mono">note</span>.
            Excel .xlsx or .csv, up to 5,000 rows. A repeated as-of date for the same lead replaces that day&apos;s status. Rows that cannot be applied are listed below and never block the others.
            {" "}<a className="text-sky underline" href="/api/v1/emi-tracker/template.csv">Download the template</a> or re-upload a tracker CSV after editing it.
          </div>
          <FilePicker file={file} onChange={setFile} hint="Excel .xlsx or .csv, up to 5,000 rows" label="Choose file" />
          <div className="flex justify-end gap-2">
            <button className="btn btn-sm" type="button" onClick={() => setUploadOpen(false)}>Close</button>
            <button className="btn btn-green btn-sm" type="button" disabled={!file || busy} onClick={upload}>{busy ? "Uploading…" : "Upload"}</button>
          </div>
          {result && (
            <div className="space-y-2 rounded-lg bg-page p-3">
              <div className="text-[13px] font-semibold">{result.fileName}: {result.applied} of {result.total} applied{result.failed ? `, ${result.failed} rejected` : ""}</div>
              {result.errors.length > 0 && (
                <div className="max-h-[260px] overflow-y-auto">
                  <table className="w-full"><thead><tr><th className="th">Row</th><th className="th">Case / File</th><th className="th">Problem</th></tr></thead><tbody>
                    {result.errors.map((e) => <tr key={e.row}><td className="td mono text-[12px]">{e.row}</td><td className="td mono text-[12px]">{e.caseNo || e.fileNo || "—"}</td><td className="td text-[12px] text-bad">{e.message}</td></tr>)}
                  </tbody></table>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
