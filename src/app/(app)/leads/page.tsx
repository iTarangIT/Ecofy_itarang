"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { get, post } from "@/lib/api";
import { useSession, useCan } from "@/components/shell/Shell";
import { Banner, Card, Empty, Hours, SegPill, StageChip, TempChip } from "@/components/ui/primitives";
import { NewLeadModal } from "@/components/cases/NewLeadModal";
import { STAGES } from "@/components/ui/primitives";
import { useUsers, type CaseSummary } from "@/lib/hooks";
import { isAdmin } from "@/core/auth/rbac";

type BulkPushResult = { pushed: number; skipped: Array<{ caseId: string; code: string; gate: string | null; message: string }> };

/** Why a selected lead was not pushed, in the words of the gate (FR-04.3). */
function skipReason(s: BulkPushResult["skipped"][number]) {
  if (s.gate === "temperature_warm") return "not Warm (Hot leads move on their own; set Cold leads to Warm first)";
  if (s.gate === "stage") return "already past S0";
  if (s.code === "NOT_FOUND") return "not visible to you";
  return s.message;
}

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
  const canPush = useCan("cases.push");
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pushResult, setPushResult] = useState<BulkPushResult | null>(null);
  const rows = cases.data?.data ?? [];
  const pushable = rows.filter((c) => c.stage === "S0" && c.owner === "ECOFY");
  const allPushableSelected = pushable.length > 0 && pushable.every((c) => selected.has(c.id));
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const toggleAll = () => setSelected(allPushableSelected ? new Set() : new Set(pushable.map((c) => c.id)));
  const bulkPush = useMutation({
    mutationFn: () => post<BulkPushResult>("/cases/bulk-push", { caseIds: [...selected] }),
    onSuccess: (r) => { setPushResult(r.data); setSelected(new Set()); void qc.invalidateQueries({ queryKey: ["cases"] }); },
  });
  const caseNo = (id: string) => rows.find((c) => c.id === id)?.caseNo ?? id;

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
        {canPush && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-sky/5 px-4 py-2 text-[12.5px]">
            <span><b>{selected.size}</b> selected</span>
            <button className="btn btn-sm btn-primary" type="button" disabled={bulkPush.isPending} onClick={() => bulkPush.mutate()}>{bulkPush.isPending ? "Pushing…" : "Push selected to iTarang"}</button>
            <button className="btn btn-sm" type="button" onClick={() => setSelected(new Set())}>Clear</button>
            <span className="text-muted">Only Warm leads at S0 are pushed; the rest are reported.</span>
          </div>
        )}
        {bulkPush.isError && <div className="px-4 py-2"><Banner kind="red">Bulk push failed: {(bulkPush.error as Error).message}</Banner></div>}
        {pushResult && (
          <div className="px-4 py-2">
            <Banner kind={pushResult.skipped.length ? "amber" : "green"}>
              Pushed {pushResult.pushed} lead{pushResult.pushed === 1 ? "" : "s"} to iTarang.
              {pushResult.skipped.length > 0 && <> Skipped {pushResult.skipped.length}: {pushResult.skipped.map((x) => `${caseNo(x.caseId)} (${skipReason(x)})`).join("; ")}.</>}
              <button className="ml-2 underline" type="button" onClick={() => setPushResult(null)}>Dismiss</button>
            </Banner>
          </div>
        )}
        <table className="w-full">
          <thead><tr>{canPush && <th className="th w-8"><input type="checkbox" aria-label="Select all S0 leads" checked={allPushableSelected} disabled={pushable.length === 0} onChange={toggleAll} /></th>}<th className="th">Case</th><th className="th">Customer</th><th className="th">Segment</th><th className="th">Temp</th><th className="th">Stage</th><th className="th">Owner / assignee</th><th className="th">In stage</th><th className="th">Updated</th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="rowlink" onClick={() => (window.location.href = `/cases/${c.id}`)}>
                {canPush && <td className="td" onClick={(e) => e.stopPropagation()}>{c.stage === "S0" && c.owner === "ECOFY" && <input type="checkbox" aria-label={`Select ${c.caseNo}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />}</td>}
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
