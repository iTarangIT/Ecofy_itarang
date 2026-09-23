"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post, errorMessage } from "@/lib/api";
import { fmtDateTime, type CaseSummary } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, Empty, Field } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";

type W = { id: string; stageAtRequest: string; reason: string; status: string; requestedAt: string; confirmedAt: string | null; ecofyAlertedAt: string | null; sanctionCancelledAt: string | null; epcInformedAt: string | null };

/** M14: before acceptance closes at once; after acceptance IA confirms, EA marks sanction cancelled, IA marks EPC informed. */
export function WithdrawalTab({ c, onChange }: { c: CaseSummary; onChange: () => void }) {
  const s = useSession();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["withdrawals", c.id], queryFn: () => get<W[]>(`/cases/${c.id}/withdrawals`) });
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["withdrawals", c.id] }); onChange(); };
  const run = async (label: string, fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); toast(label); refresh(); } catch (e) { toast(errorMessage(e), "bad"); } finally { setBusy(false); } };
  const itarang = s.role === "ITARANG_CALLER" || s.role === "ITARANG_ADMIN";
  const after = ["S5", "S6", "S7"].includes(c.stage);

  return (
    <Card title="Withdrawal" right="after disbursement this is handled by Ecofy outside the platform">
      {itarang && c.stage !== "CLOSED" && c.stage !== "S8" && (
        <div className="mb-3 flex items-end gap-2 rounded-lg bg-page p-3">
          <Field label="Reason (mandatory)" hint={after ? "After acceptance: needs iTarang Admin confirmation; the File is kept; Ecofy is alerted." : "Before acceptance: the case closes at once as WITHDRAWN."}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <button className="btn btn-danger" type="button" disabled={busy || reason.length < 3} onClick={() => run("Withdrawal recorded", () => post(`/cases/${c.id}/withdrawals`, { reason }))}>Request withdrawal</button>
        </div>
      )}
      {(q.data?.data ?? []).length === 0 && <Empty>No withdrawal.</Empty>}
      <div className="space-y-2">
        {(q.data?.data ?? []).map((w) => (
          <div key={w.id} className="rounded-lg border border-line p-3 text-[12.5px]">
            <div className="flex flex-wrap items-center gap-2"><b>At {w.stageAtRequest}</b><span className={`chip ${w.status === "CONFIRMED" ? "bg-bad-soft text-bad" : w.status === "REJECTED" ? "bg-chip text-muted" : "bg-warn-soft text-warn"}`}>{w.status}</span><span className="ml-auto text-muted">{fmtDateTime(w.requestedAt)}</span></div>
            <div>{w.reason}</div>
            <div className="mt-1 text-[11.5px] text-muted">confirmed {fmtDateTime(w.confirmedAt)} · Ecofy alerted {fmtDateTime(w.ecofyAlertedAt)} · sanction cancelled {fmtDateTime(w.sanctionCancelledAt)} · EPC informed {fmtDateTime(w.epcInformedAt)}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {s.role === "ITARANG_ADMIN" && w.status === "REQUESTED" && <><button className="btn btn-sm btn-danger" type="button" disabled={busy} onClick={() => run("Withdrawal confirmed — case closed", () => post(`/withdrawals/${w.id}/confirm`))}>Confirm withdrawal</button><button className="btn btn-sm" type="button" disabled={busy} onClick={() => { const r = window.prompt("Reason for rejecting the withdrawal?"); if (r) run("Withdrawal rejected", () => post(`/withdrawals/${w.id}/reject`, { reason: r })); }}>Reject</button></>}
              {s.role === "ECOFY_ADMIN" && w.status === "CONFIRMED" && !w.sanctionCancelledAt && <button className="btn btn-sm" type="button" disabled={busy} onClick={() => run("Sanction marked cancelled", () => post(`/withdrawals/${w.id}/sanction-cancelled`))}>Mark sanction cancelled</button>}
              {s.role === "ITARANG_ADMIN" && w.status === "CONFIRMED" && !w.epcInformedAt && <button className="btn btn-sm" type="button" disabled={busy} onClick={() => run("EPC marked informed", () => post(`/withdrawals/${w.id}/epc-informed`))}>Mark EPC informed</button>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
