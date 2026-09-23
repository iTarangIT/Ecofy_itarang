"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { Banner, Card, Empty, Field, Modal } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/components/shell/Shell";
import { fmtDate, todayIso } from "@/lib/hooks";

type Asset = { id: string; caseId: string; caseNo: string; customerName: string | null; city: string | null; systemSnapshot: { system: string | null; batteryKwh: string | null; inverterKva: string | null; solarKwp: string | null; fileNo: string | null }; commissionedOn: string; status: string; emiStatus: { asOf: string; state: string } | null; emiHistory: Array<{ id: number; asOf: string; state: string; note: string | null }>; events: Array<{ id: number; type: string; onDate: string; note: string | null }> };

/** M13: asset status, EMI status (DPD band) by Ecofy Admin, buyback and redeployment. No IoT, no risk flags (S8.3). */
export default function AssetsPage() {
  const s = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["assets"], queryFn: () => get<Asset[]>("/assets?limit=100") });
  const [sel, setSel] = useState<Asset | null>(null);
  const [emi, setEmi] = useState({ asOf: todayIso(), state: "CURRENT", note: "" });
  const [ev, setEv] = useState({ type: "BUYBACK", onDate: todayIso(), note: "" });
  const [busy, setBusy] = useState(false);
  const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); toast(label); qc.invalidateQueries({ queryKey: ["assets"] }); setSel(null); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); } };
  const emiChip = (st?: string | null) => <span className={`chip ${!st ? "bg-chip text-muted" : st === "CURRENT" ? "bg-ecofy-soft text-ecofy" : st === "CLOSED" ? "bg-navy text-white" : "bg-warn-soft text-warn"}`}>{st?.replace(/_/g, " ") ?? "no EMI status"}</span>;

  return (
    <div className="space-y-4">
      <Banner>Active assets are financed, installed systems. Ecofy Admin records the EMI status (days-past-due band) under Ecofy&apos;s own policy, and buyback or redeployment. There is no IoT data and no risk flag in V1.</Banner>
      <Card title={`Assets (${q.data?.data.length ?? 0})`} pad={false}>
        <table className="w-full"><thead><tr><th className="th">Case / File</th><th className="th">Customer</th><th className="th">System</th><th className="th">Commissioned</th><th className="th">EMI status</th><th className="th">Lifecycle</th><th className="th" /></tr></thead><tbody>
          {(q.data?.data ?? []).map((a) => (
            <tr key={a.id}><td className="td"><Link className="mono text-sky" href={`/cases/${a.caseId}`}>{a.caseNo}</Link><div className="mono text-[11.5px] text-muted">{a.systemSnapshot.fileNo}</div></td><td className="td">{a.customerName}<div className="text-[12px] text-muted">{a.city}</div></td><td className="td text-[12.5px]">{a.systemSnapshot.system}</td><td className="td text-[12px]">{fmtDate(a.commissionedOn)}</td><td className="td">{emiChip(a.emiStatus?.state)}{a.emiStatus && <div className="text-[11px] text-muted">as of {a.emiStatus.asOf}</div>}</td><td className="td"><span className={`chip ${a.status === "ACTIVE" ? "bg-ecofy-soft text-ecofy" : "bg-chip text-muted"}`}>{a.status}</span></td><td className="td text-right">{s.role === "ECOFY_ADMIN" && <button className="btn btn-sm" type="button" onClick={() => setSel(a)}>Record</button>}</td></tr>
          ))}
        </tbody></table>
        {q.data && q.data.data.length === 0 && <Empty>No assets yet — assets are created when a disbursement is recorded.</Empty>}
      </Card>
      <Modal open={Boolean(sel)} onClose={() => setSel(null)} title={`Asset — ${sel?.caseNo}`} wide>
        {sel && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 rounded-lg bg-page p-3">
              <div className="text-[13px] font-semibold">EMI status</div>
              <Field label="As of"><input className="input" type="date" value={emi.asOf} onChange={(e) => setEmi((x) => ({ ...x, asOf: e.target.value }))} /></Field>
              <Field label="State (DPD band)"><select className="input" value={emi.state} onChange={(e) => setEmi((x) => ({ ...x, state: e.target.value }))}>{["CURRENT", "DPD_1_30", "DPD_31_60", "DPD_61_90", "DPD_90_PLUS", "CLOSED"].map((st) => <option key={st}>{st}</option>)}</select></Field>
              <Field label="Note"><input className="input" value={emi.note} onChange={(e) => setEmi((x) => ({ ...x, note: e.target.value }))} /></Field>
              <button className="btn btn-green btn-sm" type="button" disabled={busy} onClick={() => run("EMI status recorded", () => post(`/assets/${sel.id}/emi-status`, { asOf: emi.asOf, state: emi.state, note: emi.note || undefined }))}>Record EMI status</button>
              <div className="text-[11.5px] text-muted">{sel.emiHistory.map((h) => `${h.asOf}: ${h.state}`).join(" · ") || "no history"}</div>
            </div>
            <div className="space-y-2 rounded-lg bg-page p-3">
              <div className="text-[13px] font-semibold">Buyback / redeployment</div>
              <Field label="Event"><select className="input" value={ev.type} onChange={(e) => setEv((x) => ({ ...x, type: e.target.value }))}><option value="BUYBACK">Buyback</option><option value="REDEPLOYED">Redeployed</option><option value="CLOSED">Closed</option></select></Field>
              <Field label="On date"><input className="input" type="date" value={ev.onDate} onChange={(e) => setEv((x) => ({ ...x, onDate: e.target.value }))} /></Field>
              <Field label="Note"><input className="input" value={ev.note} onChange={(e) => setEv((x) => ({ ...x, note: e.target.value }))} /></Field>
              <button className="btn btn-sm" type="button" disabled={busy} onClick={() => run("Asset event recorded", () => post(`/assets/${sel.id}/events`, { type: ev.type, onDate: ev.onDate, note: ev.note || undefined }))}>Record event</button>
              <div className="text-[11.5px] text-muted">{sel.events.map((e) => `${e.onDate}: ${e.type}`).join(" · ") || "no events"} — valuation, commercials and possession are executed off-platform.</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
