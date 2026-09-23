"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { Banner, Card, Empty, Field, Modal, SegPill, Hours, type CaseSummary } from "@/components/ui/primitives-with-types";
import { toast } from "@/components/ui/toast";
import { fmtDateTime } from "@/lib/hooks";

type Row = CaseSummary & { eligibility: { id: string; status: string; requestedAt: string; reason: string | null } };

/** M09 FR-09.2/9.3: the financier's role records Eligible (max amount, hidden from callers), Not eligible (reason) or Info needed. */
export default function EligibilityQueuePage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["eligibility-queue"], queryFn: () => get<Row[]>("/eligibility-queue?limit=100"), refetchInterval: 30_000 });
  const [row, setRow] = useState<Row | null>(null);
  const [f, setF] = useState({ status: "ELIGIBLE", maxEligibleInr: "", reason: "" });
  const [busy, setBusy] = useState(false);
  async function decide() {
    if (!row) return;
    setBusy(true);
    try {
      await post(`/eligibility/${row.eligibility.id}/decision`, { status: f.status, maxEligibleInr: f.status === "ELIGIBLE" ? Number(f.maxEligibleInr) : undefined, reason: f.status !== "ELIGIBLE" ? f.reason : undefined });
      toast(`${row.caseNo}: ${f.status.replace("_", " ").toLowerCase()} recorded`);
      setRow(null); qc.invalidateQueries({ queryKey: ["eligibility-queue"] });
    } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); }
  }
  return (
    <div className="space-y-4">
      <Banner>Ecofy already has what it needs for eligibility (S4.3); the platform records only the result. The maximum eligible amount is stored in a role-guarded table; callers see only within / above limit.</Banner>
      <Card title={`Cases awaiting eligibility (${q.data?.data.length ?? 0})`} pad={false}>
        <table className="w-full"><thead><tr><th className="th">Case</th><th className="th">Customer</th><th className="th">Segment</th><th className="th">Requested</th><th className="th">Waiting</th><th className="th">Status</th><th className="th" /></tr></thead><tbody>
          {(q.data?.data ?? []).map((r) => (
            <tr key={r.eligibility.id}><td className="td"><Link className="mono text-sky" href={`/cases/${r.id}`}>{r.caseNo}</Link></td><td className="td">{r.customer?.fullName}<div className="text-[12px] text-muted">{r.customer?.city}</div></td><td className="td"><SegPill segment={r.segment} /></td><td className="td text-[12px]">{fmtDateTime(r.eligibility.requestedAt)}</td><td className="td"><Hours h={r.ageing.inStageWorkingHours} /></td><td className="td"><span className="chip bg-warn-soft text-warn">{r.eligibility.status}</span></td><td className="td text-right"><button className="btn btn-sm btn-primary" type="button" onClick={() => { setRow(r); setF({ status: "ELIGIBLE", maxEligibleInr: "", reason: "" }); }}>Record decision</button></td></tr>
          ))}
        </tbody></table>
        {q.data && q.data.data.length === 0 && <Empty>Nothing awaiting eligibility.</Empty>}
      </Card>
      <Modal open={Boolean(row)} onClose={() => setRow(null)} title={`Eligibility — ${row?.caseNo}`}>
        <div className="space-y-3">
          <Field label="Decision"><select className="input" value={f.status} onChange={(e) => setF((x) => ({ ...x, status: e.target.value }))}><option value="ELIGIBLE">Eligible (maximum amount)</option><option value="NOT_ELIGIBLE">Not eligible (reason)</option><option value="INFO_NEEDED">Info needed (note to the caller)</option></select></Field>
          {f.status === "ELIGIBLE" ? <Field label="Maximum eligible amount (₹, visible to your role only)"><input className="input mono" type="number" min={1} value={f.maxEligibleInr} onChange={(e) => setF((x) => ({ ...x, maxEligibleInr: e.target.value }))} /></Field> : <Field label={f.status === "NOT_ELIGIBLE" ? "Reason" : "Note to the caller"}><textarea className="input" rows={3} value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} /></Field>}
          <div className="flex justify-end gap-2"><button className="btn" type="button" onClick={() => setRow(null)}>Cancel</button><button className="btn btn-green" type="button" disabled={busy} onClick={decide}>Record</button></div>
        </div>
      </Modal>
    </div>
  );
}
