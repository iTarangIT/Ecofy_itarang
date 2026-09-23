"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { Banner, Card, Empty, SegPill, Hours, StageChip } from "@/components/ui/primitives";
import { fmtDateTime, inr, type CaseSummary } from "@/lib/hooks";

type Row = CaseSummary & { decision: { id: string; attemptNo: number; submittedAt: string }; file: { id: string; fileNo: string; acceptedTotalInr: number; quoteVersion: number; acceptedAt: string } | null };

/** M11 FR-11.1: Files awaiting a decision for the financiers whose values this role may see. */
export default function FinancingQueuePage() {
  const q = useQuery({ queryKey: ["financing-queue"], queryFn: () => get<Row[]>("/financing-queue?limit=100"), refetchInterval: 30_000 });
  return (
    <div className="space-y-4">
      <Banner>Financing decisions are recorded, not executed. Open the case to record Sanctioned (amount; optional down payment, tenure, EMI from the lender, file number) or Rejected (reason). A sanction below the accepted total triggers a re-acceptance OTP.</Banner>
      <Card title={`Files awaiting a decision (${q.data?.data.length ?? 0})`} pad={false}>
        <table className="w-full"><thead><tr><th className="th">File</th><th className="th">Case</th><th className="th">Customer</th><th className="th">Segment</th><th className="th">Accepted total</th><th className="th">Attempt</th><th className="th">Submitted</th><th className="th">Waiting</th><th className="th">Stage</th></tr></thead><tbody>
          {(q.data?.data ?? []).map((r) => (
            <tr key={r.decision.id} className="rowlink" onClick={() => (window.location.href = `/cases/${r.id}`)}><td className="td mono">{r.file?.fileNo}</td><td className="td"><Link className="mono text-sky" href={`/cases/${r.id}`}>{r.caseNo}</Link></td><td className="td">{r.customer?.fullName}<div className="text-[12px] text-muted">{r.customer?.city}</div></td><td className="td"><SegPill segment={r.segment} /></td><td className="td mono">{inr(r.file?.acceptedTotalInr)}</td><td className="td mono">{r.decision.attemptNo}</td><td className="td text-[12px]">{fmtDateTime(r.decision.submittedAt)}</td><td className="td"><Hours h={r.ageing.inStageWorkingHours} /></td><td className="td"><StageChip stage={r.stage} subStatus={r.subStatus} /></td></tr>
          ))}
        </tbody></table>
        {q.data && q.data.data.length === 0 && <Empty>No Files awaiting a decision.</Empty>}
      </Card>
    </div>
  );
}
