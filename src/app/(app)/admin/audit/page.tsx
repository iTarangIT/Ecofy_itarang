"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { Card, Empty } from "@/components/ui/primitives";
import { fmtDateTime } from "@/lib/hooks";

type Row = { id: number; at: string; actorName: string | null; actorRole: string | null; action: string; entityType: string; entityId: string; caseId: string | null; before: unknown; after: unknown; reason: string | null };

export default function AuditPage() {
  const [f, setF] = useState({ action: "", caseId: "", from: "", to: "" });
  const [cursor, setCursor] = useState<string | null>(null);
  const params = new URLSearchParams({ limit: "50", ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), ...(cursor ? { cursor } : {}) });
  const q = useQuery({ queryKey: ["audit", params.toString()], queryFn: () => get<Row[]>(`/audit?${params.toString()}`) });
  return (
    <Card title="Audit log" right="insert-only; every state change, value, setting, export and login" pad={false}>
      <div className="flex flex-wrap gap-2 border-b border-line px-4 py-3">
        <input className="input w-48" placeholder="action prefix (case., otp., setting.)" onChange={(e) => { setCursor(null); setF((x) => ({ ...x, action: e.target.value })); }} />
        <input className="input w-72 mono" placeholder="case id (uuid)" onChange={(e) => { setCursor(null); setF((x) => ({ ...x, caseId: e.target.value })); }} />
        <input className="input w-40" type="date" onChange={(e) => setF((x) => ({ ...x, from: e.target.value ? new Date(e.target.value).toISOString() : "" }))} />
        <input className="input w-40" type="date" onChange={(e) => setF((x) => ({ ...x, to: e.target.value ? new Date(e.target.value + "T23:59:59").toISOString() : "" }))} />
      </div>
      <table className="w-full"><thead><tr><th className="th">When</th><th className="th">Actor</th><th className="th">Action</th><th className="th">Entity</th><th className="th">Change</th></tr></thead><tbody>
        {(q.data?.data ?? []).map((r) => (
          <tr key={r.id}><td className="td mono text-[11.5px]">{fmtDateTime(r.at)}</td><td className="td text-[12px]">{r.actorName ?? "Platform"}<div className="text-muted">{r.actorRole ?? ""}</div></td><td className="td mono text-[12px]">{r.action}</td><td className="td text-[12px]">{r.entityType} <span className="mono text-muted">{r.entityId.slice(0, 8)}</span>{r.caseId && <div><a className="text-sky" href={`/cases/${r.caseId}`}>case</a></div>}</td><td className="td text-[11.5px] text-muted"><div className="max-w-[420px] truncate" title={JSON.stringify({ before: r.before, after: r.after })}>{r.reason ? `reason: ${r.reason} · ` : ""}{r.after ? JSON.stringify(r.after) : ""}</div></td></tr>
        ))}
      </tbody></table>
      {q.data && q.data.data.length === 0 && <Empty>No audit rows match.</Empty>}
      {q.data?.meta?.nextCursor && <div className="px-4 py-3"><button className="btn btn-sm" type="button" onClick={() => setCursor(q.data!.meta!.nextCursor as string)}>Load more</button></div>}
    </Card>
  );
}
