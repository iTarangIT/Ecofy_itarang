"use client";

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { Banner, Card, Kpi } from "@/components/ui/primitives";
import { ROLE_LABEL } from "@/core/auth/rbac";

type Usage = { month: string; seatsByRole: Record<string, { used: number; limit: number }>; filesCreated: number; filesToDate: number; activeAssets: number; filesByMonth: Array<{ month: string; files: number }> };

/** FR-17.7: usage counts for the off-platform commercial agreement; nothing is blocked. */
export default function UsagePage() {
  const q = useQuery({ queryKey: ["usage"], queryFn: () => get<Usage[]>("/usage") });
  const u = q.data?.data[0];
  return (
    <div className="space-y-4">
      <Banner>Billing is contractual and off-platform in V1. This view shows seats by role, Files created (the billable event) per month and to date, and active assets. Counts only — access is never blocked on a commercial threshold.</Banner>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Kpi label={`Files in ${u?.month ?? "—"}`} value={u?.filesCreated ?? "—"} />
        <Kpi label="Files to date" value={u?.filesToDate ?? "—"} />
        <Kpi label="Active assets" value={u?.activeAssets ?? "—"} />
        <Kpi label="Seats used" value={u ? Object.values(u.seatsByRole).reduce((a, b) => a + b.used, 0) : "—"} sub={u ? `of ${Object.values(u.seatsByRole).reduce((a, b) => a + b.limit, 0)}` : ""} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Seats by role"><table className="w-full"><tbody>{u && Object.entries(u.seatsByRole).map(([r, v]) => <tr key={r}><td className="td">{ROLE_LABEL[r as keyof typeof ROLE_LABEL] ?? r}</td><td className="td mono text-right">{v.used} / {v.limit}</td></tr>)}</tbody></table></Card>
        <Card title="Files by month"><table className="w-full"><tbody>{(u?.filesByMonth ?? []).map((m) => <tr key={m.month}><td className="td mono">{m.month}</td><td className="td mono text-right">{m.files}</td></tr>)}{u && u.filesByMonth.length === 0 && <tr><td className="td text-muted">No Files yet.</td></tr>}</tbody></table></Card>
      </div>
      <Card title="Reports (CSV, logged)"><div className="flex flex-wrap gap-2">{["cases", "funnel", "ageing", "activities", "files", "financing"].map((c) => <a key={c} className="btn btn-sm" href={`/api/v1/reports/${c}.csv`}>{c}.csv</a>)}</div><p className="mt-2 text-[11.5px] text-muted">Mobiles are masked in exports; financing values appear only in Ecofy Admin&apos;s financing report.</p></Card>
    </div>
  );
}
