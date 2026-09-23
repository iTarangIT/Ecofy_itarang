"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { Banner, Card, Field } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useSettings } from "@/lib/hooks";

type ImportView = { id: string; status: string; fileName: string; rowCount: number; headers?: string[]; suggestedMapping?: Record<string, string | null>; savedMappings?: Array<{ id: string; sourceName: string; mapping: Record<string, string> }>; uploadPending?: boolean; preview?: Preview };
type Preview = { rowCount: number; created: number; duplicate: number; reopened: number; newLinked: number; rejected: number; sampleErrors: Array<{ rowNo: number; column?: string; code: string; message: string }> };

const COLUMNS = ["customer_name", "mobile", "segment", "pincode", "consent_obtained", "consent_date", "consent_source", "city", "state", "address", "customer_type", "business_name", "ecofy_lead_id", "alternate_mobile", "email", "preferred_language", "property_type", "product_interest", "avg_monthly_bill_inr", "sanctioned_load_kw", "existing_backup", "preferred_call_time", "assign_to"];

/** M03 import wizard: upload → map → validate → commit (consent confirmation) → report. */
export default function ImportPage() {
  const [importId, setImportId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saveAs, setSaveAs] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const settings = useSettings();
  const attestation = String(settings.data?.data["intake.consent_attestation_text"] ?? "");
  const imp = useQuery({ queryKey: ["import", importId], queryFn: () => get<ImportView>(`/imports/${importId}`), enabled: Boolean(importId), refetchInterval: (q) => (q.state.data?.data.status === "COMMITTING" ? 3000 : false) });
  const view = imp.data?.data;

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const start = await post<{ id: string; uploadUrl: string; headers?: Record<string, string> }>("/imports", { fileName: file.name, sizeBytes: file.size });
      const put = await fetch(start.data.uploadUrl, { method: "PUT", body: file, headers: start.data.headers ?? {} });
      if (!put.ok) throw new Error(`Upload failed (${put.status})`);
      setImportId(start.data.id);
      const v = await get<ImportView>(`/imports/${start.data.id}`);
      const sugg = v.data.suggestedMapping ?? {};
      setMapping(Object.fromEntries(Object.entries(sugg).filter(([, t]) => t).map(([h, t]) => [h, t as string])));
      toast("File uploaded — check the column mapping");
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }

  async function saveMapping() {
    if (!importId) return;
    setBusy(true);
    try {
      await post(`/imports/${importId}/mapping`, { mapping, saveAs: saveAs || undefined });
      const r = await post<Preview>(`/imports/${importId}/validate`);
      setPreview(r.data);
      imp.refetch();
      toast(`Validated: ${r.data.created} to create, ${r.data.duplicate} duplicate, ${r.data.reopened} reopen, ${r.data.rejected} rejected`);
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }

  async function commit() {
    if (!importId) return;
    if (!consent) return toast("Tick the consent confirmation first", "warn");
    setBusy(true);
    try {
      await post(`/imports/${importId}/commit`, { consentAttested: true, attestationText: attestation }, { idempotent: true });
      toast("Import committed — processing in the background");
      imp.refetch();
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }

  const headers = view?.headers ?? [];
  const mandatoryMissing = ["customer_name", "mobile", "segment", "pincode", "consent_obtained", "consent_date", "consent_source", "city", "state", "address", "customer_type"].filter((m) => !Object.values(mapping).includes(m));

  return (
    <div className="space-y-4">
      <Banner>Upload the{" "}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- file download from the API, not a page */}
        <a className="text-sky underline" href="/api/v1/imports/template">lead upload template v0.3</a> (.xlsx or .csv, up to 5,000 rows). One case per mobile: matches on an open case are linked, closed cases are reopened, and a case that reached a File gets a new linked case. Consent per lead is mandatory; the upload confirmation is logged.</Banner>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="1 · Upload file">
          <div className="space-y-3">
            <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[13px]" />
            <button className="btn btn-primary" type="button" disabled={!file || busy} onClick={upload}>Upload</button>
            {view && <div className="text-[12px] text-muted">Import <span className="mono">{view.id}</span> · {view.fileName} · status <b>{view.status}</b>{view.rowCount ? ` · ${view.rowCount} rows` : ""}</div>}
          </div>
        </Card>
        <Card title="2 · Map columns" right={headers.length ? `${headers.length} headers found` : ""}>
          {!headers.length && <div className="text-[12.5px] text-muted">Upload a file to see its headers. Headers are auto-matched; map the rest once and save the mapping per source.</div>}
          {headers.length > 0 && (
            <div className="space-y-2">
              {(view?.savedMappings?.length ?? 0) > 0 && (
                <Field label="Saved mapping"><select className="input" onChange={(e) => { const m = view!.savedMappings!.find((x) => x.id === e.target.value); if (m) setMapping(m.mapping); }}><option value="">—</option>{view!.savedMappings!.map((m) => <option key={m.id} value={m.id}>{m.sourceName}</option>)}</select></Field>
              )}
              <div className="max-h-[320px] overflow-y-auto">
                <table className="w-full"><thead><tr><th className="th">Source header</th><th className="th">Template column</th></tr></thead><tbody>
                  {headers.map((h) => (
                    <tr key={h}><td className="td mono text-[12px]">{h}</td><td className="td"><select className="input" value={mapping[h] ?? ""} onChange={(e) => setMapping((m) => { const n = { ...m }; if (e.target.value) n[h] = e.target.value; else delete n[h]; return n; })}><option value="">— ignore —</option>{COLUMNS.map((c) => <option key={c} value={c}>{c}</option>)}</select></td></tr>
                  ))}
                </tbody></table>
              </div>
              {mandatoryMissing.length > 0 && <div className="banner banner-amber">Mandatory columns not mapped: {mandatoryMissing.join(", ")}</div>}
              <Field label="Save this mapping as (source name, optional)"><input className="input" value={saveAs} onChange={(e) => setSaveAs(e.target.value)} placeholder="Ecofy CRM export" /></Field>
              <button className="btn btn-primary" type="button" disabled={busy || mandatoryMissing.length > 0} onClick={saveMapping}>Save mapping & validate</button>
            </div>
          )}
        </Card>
        <Card title="3 · Preview">
          {!preview && !view?.preview && <div className="text-[12.5px] text-muted">Validate to see created / duplicate / reopened / rejected counts before committing.</div>}
          {(preview ?? view?.preview) && (() => { const p = (preview ?? view!.preview)!; return (
            <div className="space-y-3">
              <table className="w-full text-[13px]"><tbody>
                <tr><td className="td">Rows received</td><td className="td mono text-right">{p.rowCount}</td></tr>
                <tr><td className="td">Created as new cases</td><td className="td mono text-right text-ok">{p.created}</td></tr>
                <tr><td className="td">Duplicates (linked to an open case, or repeated in file)</td><td className="td mono text-right text-warn">{p.duplicate}</td></tr>
                <tr><td className="td">Closed cases reopened</td><td className="td mono text-right">{p.reopened}</td></tr>
                <tr><td className="td">New cases linked to a case with a File</td><td className="td mono text-right">{p.newLinked}</td></tr>
                <tr><td className="td">Rejected</td><td className="td mono text-right text-bad">{p.rejected}</td></tr>
              </tbody></table>
              {p.sampleErrors.length > 0 && <div className="max-h-[200px] overflow-y-auto rounded-lg bg-page p-2 text-[12px]">{p.sampleErrors.map((e, i) => <div key={i}><span className="mono">row {e.rowNo}</span> · {e.column ? <b>{e.column}</b> : null} {e.message}</div>)}</div>}
            </div>
          ); })()}
        </Card>
        <Card title="4 · Commit with consent confirmation">
          <div className="space-y-3">
            <label className="flex items-start gap-2 rounded-lg bg-page p-3 text-[12.5px]"><input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>{attestation || "Loading attestation text…"}</span></label>
            <button className="btn btn-green" type="button" disabled={busy || !consent || !(preview ?? view?.preview) || view?.status === "COMMITTED" || view?.status === "COMMITTING"} onClick={commit}>Commit import</button>
            {view?.status === "COMMITTING" && <div className="text-[12.5px] text-muted">Processing rows in chunks of 500…</div>}
            {view?.status === "COMMITTED" && (
              <div className="space-y-2">
                <div className="banner banner-green">Committed. {view.preview?.created} created · {view.preview?.duplicate} duplicate · {view.preview?.reopened} reopened · {view.preview?.rejected} rejected.</div>
                <a className="btn btn-sm" href={`/api/v1/imports/${view.id}/report.csv`}>Download row report (CSV)</a>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
