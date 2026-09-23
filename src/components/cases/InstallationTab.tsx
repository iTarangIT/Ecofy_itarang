"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, patch, errorMessage } from "@/lib/api";
import { useEpcPartners, fmtDateTime, todayIso, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, Empty, Field } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

type Installation = { id: string; status: string; epcPartnerName: string | null; scheduledOn: string | null; startedOn: string | null; completedOn: string | null; startedBeforeSanction: boolean; stopReason: string | null; events: Array<{ id: number; status: string; note: string | null; at: string }> };
const NEXT: Record<string, string[]> = { NOT_STARTED: ["SCHEDULED", "IN_PROGRESS", "STOPPED"], SCHEDULED: ["IN_PROGRESS", "STOPPED"], IN_PROGRESS: ["INSTALLED", "STOPPED"], INSTALLED: ["COMMISSIONED", "STOPPED"], COMMISSIONED: [], STOPPED: [] };

/** M12: installation is a separate state machine that may run while the case is still at S6 (BRD 4.3). */
export function InstallationTab({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const itarang = s.role === "ITARANG_CALLER" || s.role === "ITARANG_ADMIN";
  const q = useQuery({ queryKey: ["installation", c.id], queryFn: () => get<Installation | null>(`/cases/${c.id}/installation`) });
  const epcs = useEpcPartners();
  const [epc, setEpc] = useState("");
  const [scheduledOn, setScheduledOn] = useState("");
  const [u, setU] = useState({ status: "", onDate: todayIso(), note: "", stopReason: "", ack: false });
  const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["installation", c.id] }); onChange(); };
  const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); toast(label); refresh(); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); } };
  const inst = q.data?.data ?? null;

  return (
    <Card title="Installation (EPC executes)" right={inst ? `status ${inst.status}` : ""}>
      {!inst && !itarang && <Empty>No installation record yet.</Empty>}
      {!inst && itarang && (c.stage === "S6" || c.stage === "S7") && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-page p-3">
          <Field label="EPC partner"><select className="input" value={epc} onChange={(e) => setEpc(e.target.value)}><option value="">—</option>{(epcs.data?.data ?? []).filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Scheduled on (optional)"><input className="input" type="date" value={scheduledOn} onChange={(e) => setScheduledOn(e.target.value)} /></Field>
          <button className="btn btn-primary btn-sm" type="button" disabled={busy || !epc} onClick={() => run("Installation created", () => post(`/cases/${c.id}/installation`, { epcPartnerId: epc, scheduledOn: scheduledOn || undefined }))}>Create installation</button>
        </div>
      )}
      {!inst && itarang && !(c.stage === "S6" || c.stage === "S7") && <Empty>Installation is created after the File (S6).</Empty>}
      {inst && (
        <div className="space-y-3 text-[12.5px]">
          {inst.startedBeforeSanction && <div className="banner banner-amber">Started before sanction (acknowledged and audited). The case enters S7 only when the sanction is recorded.</div>}
          <dl className="kv"><dt>EPC partner</dt><dd>{inst.epcPartnerName}</dd><dt>Scheduled</dt><dd>{inst.scheduledOn ?? "—"}</dd><dt>Started</dt><dd>{inst.startedOn ?? "—"}</dd><dt>Completed</dt><dd>{inst.completedOn ?? "—"}</dd>{inst.stopReason && <><dt>Stopped</dt><dd className="text-bad">{inst.stopReason}</dd></>}</dl>
          <div className="space-y-1">{inst.events.map((e) => <div key={e.id} className="grid grid-cols-[120px_1fr] gap-2 text-[12px]"><span className="mono text-muted">{fmtDateTime(e.at)}</span><span><b>{e.status}</b> {e.note ? `— ${e.note}` : ""}</span></div>)}</div>
          {itarang && NEXT[inst.status]?.length > 0 && (
            <form className="grid grid-cols-3 gap-2 rounded-lg bg-page p-3" onSubmit={(e) => { e.preventDefault(); run(`Installation ${u.status}`, () => patch(`/installations/${inst.id}`, { status: u.status, onDate: u.onDate || undefined, note: u.note || undefined, stopReason: u.status === "STOPPED" ? u.stopReason : undefined, acknowledgeNoSanction: u.ack || undefined })); }}>
              <Field label="New status"><select className="input" required value={u.status} onChange={(e) => setU((x) => ({ ...x, status: e.target.value }))}><option value="">—</option>{NEXT[inst.status].map((st) => <option key={st}>{st}</option>)}</select></Field>
              <Field label="Date"><input className="input" type="date" value={u.onDate} onChange={(e) => setU((x) => ({ ...x, onDate: e.target.value }))} /></Field>
              <Field label="Note"><input className="input" value={u.note} onChange={(e) => setU((x) => ({ ...x, note: e.target.value }))} /></Field>
              {u.status === "STOPPED" && <div className="col-span-3"><Field label="Stop reason (mandatory)"><input className="input" required minLength={3} value={u.stopReason} onChange={(e) => setU((x) => ({ ...x, stopReason: e.target.value }))} /></Field></div>}
              {(u.status === "IN_PROGRESS" || u.status === "INSTALLED") && c.stage === "S6" && <label className="col-span-3 flex items-start gap-2 rounded-lg border border-[#f0dcaf] bg-warn-soft p-2 text-[12px]"><input type="checkbox" checked={u.ack} onChange={(e) => setU((x) => ({ ...x, ack: e.target.checked }))} className="mt-0.5" /><span><b>Warning:</b> no sanction is recorded yet. I acknowledge that installation starts before sanction (audited; cost exposure per W.2).</span></label>}
              {(u.status === "INSTALLED" || u.status === "COMMISSIONED") && <div className="col-span-3 text-[11.5px] text-muted">INSTALLED needs at least one installation photo and the signed customer acceptance letter on the case (Documents tab).</div>}
              <div className="col-span-3 flex justify-end"><button className="btn btn-primary btn-sm" type="submit" disabled={busy || !u.status}>Update</button></div>
            </form>
          )}
        </div>
      )}
    </Card>
  );
}
