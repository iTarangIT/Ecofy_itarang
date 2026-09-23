"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { Banner, Card, Empty, Hours, Modal, Field, SegPill, TempChip } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { useUsers, useList, type CaseSummary } from "@/lib/hooks";

/** M05 pickup queue: Hot first, then Warm by push time; ageing only (no SLA targets or colours — S1.1/S1.2). */
export default function QueuePage() {
  const qc = useQueryClient();
  const queue = useQuery({ queryKey: ["queue"], queryFn: () => get<CaseSummary[]>("/queue?limit=100"), refetchInterval: 30_000 });
  const users = useUsers();
  const reasons = useList("return_reason");
  const callers = (users.data?.data ?? []).filter((u) => (u.role === "ITARANG_CALLER" || u.role === "ITARANG_ADMIN") && u.status === "ACTIVE");
  const [pick, setPick] = useState<Record<string, string>>({});
  const [ret, setRet] = useState<CaseSummary | null>(null);
  const [retForm, setRetForm] = useState({ reasonCode: "", note: "" });

  async function assign(c: CaseSummary) {
    const userId = pick[c.id] || callers[0]?.id;
    if (!userId) return toast("No active caller to assign", "warn");
    try {
      await post(`/cases/${c.id}/assign`, { userId }, { ifMatch: c.version });
      toast(`${c.caseNo} assigned — case at S2`);
      qc.invalidateQueries({ queryKey: ["queue"] });
    } catch (e) { toast(errorMessage(e), "bad"); }
  }

  async function doReturn() {
    if (!ret) return;
    try {
      await post(`/cases/${ret.id}/return`, retForm, { ifMatch: ret.version });
      toast(`${ret.caseNo} returned to Ecofy (${retForm.reasonCode})`);
      setRet(null);
      qc.invalidateQueries({ queryKey: ["queue"] });
    } catch (e) { toast(errorMessage(e), "bad"); }
  }

  return (
    <div className="space-y-4">
      <Banner><b>Handoff point.</b> Hot leads land here automatically; Warm leads arrive when Ecofy pushes them. Ageing is shown in working hours (Mon–Fri 10:00–19:00). There are no pickup targets or SLA colours in V1.</Banner>
      <Card title={`Pickup queue (${queue.data?.data.length ?? 0})`} pad={false}>
        <table className="w-full">
          <thead><tr><th className="th">Lead</th><th className="th">Temp</th><th className="th">Segment</th><th className="th">City</th><th className="th">Qualified by</th><th className="th">Queue age</th><th className="th">Action</th></tr></thead>
          <tbody>
            {(queue.data?.data ?? []).map((c) => (
              <tr key={c.id}>
                <td className="td"><Link className="font-semibold text-sky" href={`/cases/${c.id}`}>{c.customer?.fullName}</Link><div className="mono text-[11.5px] text-muted">{c.caseNo}</div></td>
                <td className="td"><TempChip temperature={c.temperature} /></td>
                <td className="td"><SegPill segment={c.segment} /></td>
                <td className="td">{c.customer?.city}</td>
                <td className="td text-[12px]">{c.qualifiedByName ?? (c.owner === "ITARANG" ? "iTarang-sourced" : "—")}</td>
                <td className="td"><Hours h={c.ageing.inStageWorkingHours} /></td>
                <td className="td">
                  <div className="flex items-center gap-1.5">
                    <select className="input w-36" value={pick[c.id] ?? callers[0]?.id ?? ""} onChange={(e) => setPick((p) => ({ ...p, [c.id]: e.target.value }))}>{callers.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
                    <button className="btn btn-sm btn-primary" type="button" onClick={() => assign(c)}>Assign</button>
                    {c.owner === "ECOFY" && <button className="btn btn-sm btn-danger" type="button" onClick={() => { setRet(c); setRetForm({ reasonCode: reasons.data?.data[0]?.code ?? "", note: "" }); }}>Return</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {queue.data && queue.data.data.length === 0 && <Empty>Queue is empty — no Hot or pushed Warm leads awaiting pickup.</Empty>}
      </Card>
      <Modal open={Boolean(ret)} onClose={() => setRet(null)} title={`Return ${ret?.caseNo} to Ecofy`}>
        <div className="space-y-3">
          <Field label="Reason (list)"><select className="input" value={retForm.reasonCode} onChange={(e) => setRetForm((f) => ({ ...f, reasonCode: e.target.value }))}>{(reasons.data?.data ?? []).map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</select></Field>
          <Field label="Note"><textarea className="input" rows={3} value={retForm.note} onChange={(e) => setRetForm((f) => ({ ...f, note: e.target.value }))} /></Field>
          <div className="flex justify-end gap-2"><button className="btn" type="button" onClick={() => setRet(null)}>Cancel</button><button className="btn btn-danger" type="button" onClick={doReturn}>Return to qualifier</button></div>
        </div>
      </Modal>
    </div>
  );
}
