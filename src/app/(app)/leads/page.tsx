"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useSession, useCan } from "@/components/shell/Shell";
import { Card, Empty, Hours, SegPill, StageChip, TempChip } from "@/components/ui/primitives";
import { NewLeadModal } from "@/components/cases/NewLeadModal";
import { STAGES } from "@/components/ui/primitives";
import { useUsers, type CaseSummary } from "@/lib/hooks";
import { isAdmin } from "@/core/auth/rbac";

export default function LeadsPage() {
  const s = useSession();
  const admin = isAdmin(s.role);
  const [q, setQ] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const users = useUsers(admin);
  const params = new URLSearchParams({ limit: "50", ...Object.fromEntries(Object.entries(q).filter(([, v]) => v)) , ...(cursor ? { cursor } : {}) });
  const cases = useQuery({ queryKey: ["cases", params.toString()], queryFn: () => get<CaseSummary[]>(`/cases?${params.toString()}`) });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setCursor(null); setQ((x) => ({ ...x, [k]: e.target.value })); };
  const canCreate = useCan("cases.create");
  const canImport = useCan("leads.import");

  return (
    <div className="space-y-4">
      <Card title="Leads & cases" right={<div className="flex items-center gap-2">
        {canImport && <Link className="btn btn-sm btn-green" href="/leads/import">⬆ Import leads</Link>}
        {canCreate && <button className="btn btn-sm btn-primary" type="button" onClick={() => setNewOpen(true)}>+ New lead</button>}
      </div>} pad={false}>
        <div className="flex flex-wrap items-end gap-2 border-b border-line px-4 py-3">
          <input className="input w-56" placeholder="Search case no, name, mobile, city" onChange={set("q")} />
          <select className="input w-40" onChange={set("stage")}><option value="">All stages</option>{[...STAGES, "CLOSED"].map((st) => <option key={st} value={st}>{st}</option>)}</select>
          <select className="input w-36" onChange={set("segment")}><option value="">All segments</option><option value="RESI">RESI</option><option value="ESS">ESS</option><option value="CI">C&amp;I</option></select>
          <select className="input w-40" onChange={set("temperature")}><option value="">Any temperature</option><option value="HOT">Hot</option><option value="WARM">Warm</option><option value="COLD">Cold</option><option value="NOT_INTERESTED">Not interested</option></select>
          {admin && <select className="input w-44" onChange={set("userId")}><option value="">Any assignee</option>{(users.data?.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>}
          {admin && <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" onChange={(e) => setQ((x) => ({ ...x, unassigned: e.target.checked ? "true" : "" }))} /> Unassigned</label>}
          <label className="flex items-center gap-1 text-[12px]"><input type="checkbox" onChange={(e) => setQ((x) => ({ ...x, overdue: e.target.checked ? "true" : "" }))} /> Overdue follow-up</label>
        </div>
        <table className="w-full">
          <thead><tr><th className="th">Case</th><th className="th">Customer</th><th className="th">Segment</th><th className="th">Temp</th><th className="th">Stage</th><th className="th">Owner / assignee</th><th className="th">In stage</th><th className="th">Updated</th></tr></thead>
          <tbody>
            {(cases.data?.data ?? []).map((c) => (
              <tr key={c.id} className="rowlink" onClick={() => (window.location.href = `/cases/${c.id}`)}>
                <td className="td"><Link className="mono text-sky" href={`/cases/${c.id}`}>{c.caseNo}</Link></td>
                <td className="td"><div className="font-semibold">{c.customer?.fullName}</div><div className="text-[12px] text-muted">{c.customer?.city} · <span className="mono">{c.customer?.mobile}</span></div></td>
                <td className="td"><SegPill segment={c.segment} /></td>
                <td className="td"><TempChip temperature={c.temperature} /></td>
                <td className="td"><StageChip stage={c.stage} subStatus={c.subStatus} /></td>
                <td className="td"><div className="text-[12px]">{c.owner === "ECOFY" ? "Ecofy" : "iTarang"}</div><div className="text-[12px] text-muted">{c.assignedUserName ?? "unassigned"}</div></td>
                <td className="td"><Hours h={c.ageing.inStageWorkingHours} /></td>
                <td className="td text-[12px] text-muted">{new Date(c.updatedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {cases.data && cases.data.data.length === 0 && <Empty>No cases match the filters.</Empty>}
        {cases.data?.meta?.nextCursor && <div className="px-4 py-3"><button className="btn btn-sm" type="button" onClick={() => setCursor(cases.data!.meta!.nextCursor as string)}>Load more</button></div>}
      </Card>
      <NewLeadModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}
