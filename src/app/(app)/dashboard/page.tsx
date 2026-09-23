"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { useSession } from "@/components/shell/Shell";
import { Banner, Card, Kpi, StageChip, Hours } from "@/components/ui/primitives";
import { isAdmin } from "@/core/auth/rbac";

type Funnel = { byStage: Array<{ stage: string; open: number; entered: number }>; total: number; conversion: Record<string, number | null> };
type Ageing = { bands: number[]; byStage: Record<string, Record<string, number>>; cases: Array<{ id: string; caseNo: string; stage: string; inStageWorkingHours: number; band: string }> };
type Stats = { calls: number; appointmentsScheduled: number; appointmentsHeld: number; noShowRate: number | null; epcVisits: number; assessments: number; quotesUploaded: number; offers: number; files: number; hotToFirstCallHoursAvg: number | null };

export default function DashboardPage() {
  const s = useSession();
  const admin = isAdmin(s.role);
  const funnel = useQuery({ queryKey: ["funnel"], queryFn: () => get<Funnel>("/dashboards/funnel") });
  const ageing = useQuery({ queryKey: ["ageing"], queryFn: () => get<Ageing>("/dashboards/ageing") });
  const me = useQuery({ queryKey: ["userStats", s.userId], queryFn: () => get<Stats>(`/dashboards/users/${s.userId}`) });
  const by = (st: string) => funnel.data?.data.byStage.find((b) => b.stage === st)?.open ?? 0;
  const max = Math.max(1, ...(funnel.data?.data.byStage.map((b) => b.open) ?? [1]));
  const ownerOf = (st: string) => (["S0", "S6", "S8"].includes(st) ? "bg-ecofy" : st === "S7" ? "bg-epc" : "bg-sky");

  return (
    <div className="space-y-4">
      <Banner>
        <b>Platform boundary.</b> iTarang records states and enforces gates with evidence. Credit, KYC, sanction and disbursement decisions are Ecofy&apos;s, on Ecofy&apos;s systems; installation and service are the EPC partner&apos;s. The platform never moves money.
      </Banner>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={admin ? "Ecofy base being worked" : "My cases at S0"} value={by("S0")} sub={`${by("S1")} in the pickup queue`} />
        <Kpi label="In follow-up / assessment" value={by("S2") + by("S3")} sub={`${by("S4") + by("S5")} at offer / acceptance`} />
        <Kpi label="With Ecofy — financing" value={by("S6")} sub={`${by("S7")} installing`} />
        <Kpi label="Active assets" value={by("S8")} sub={`${funnel.data?.data.total ?? 0} open cases in total`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card title="Pipeline — open cases by stage" right={admin ? "all cases" : "your cases"}>
          <div className="space-y-2">
            {(funnel.data?.data.byStage ?? []).filter((b) => b.stage !== "CLOSED").map((b) => (
              <div key={b.stage} className="grid grid-cols-[120px_1fr_40px] items-center gap-2 text-[12.5px]">
                <StageChip stage={b.stage} />
                <div className="h-3 rounded bg-chip"><div className={`h-3 rounded ${ownerOf(b.stage)}`} style={{ width: `${Math.round((b.open / max) * 100)}%` }} /></div>
                <div className="mono text-right">{b.open}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-4 text-[11px] text-muted"><span><i className="inline-block h-2 w-3 bg-sky" /> iTarang executes</span><span><i className="inline-block h-2 w-3 bg-ecofy" /> Ecofy executes</span><span><i className="inline-block h-2 w-3 bg-epc" /> EPC executes</span></div>
          {funnel.data?.data.conversion && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
              {Object.entries(funnel.data.data.conversion).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-page px-2 py-1.5"><div className="text-muted">{k.replace("From", " ← ")}</div><div className="mono font-semibold">{v === null ? "—" : `${v}%`}</div></div>
              ))}
            </div>
          )}
        </Card>
        <Card title="My activity" right="all time">
          <div className="kv">
            <dt>Calls</dt><dd className="mono">{me.data?.data.calls ?? "—"}</dd>
            <dt>Appointments (held / scheduled)</dt><dd className="mono">{me.data?.data.appointmentsHeld ?? 0} / {me.data?.data.appointmentsScheduled ?? 0}</dd>
            <dt>No-show rate</dt><dd className="mono">{me.data?.data.noShowRate == null ? "—" : `${me.data.data.noShowRate}%`}</dd>
            <dt>EPC visits</dt><dd className="mono">{me.data?.data.epcVisits ?? 0}</dd>
            <dt>Assessments / quotes / offers</dt><dd className="mono">{me.data?.data.assessments ?? 0} / {me.data?.data.quotesUploaded ?? 0} / {me.data?.data.offers ?? 0}</dd>
            <dt>Files</dt><dd className="mono">{me.data?.data.files ?? 0}</dd>
            <dt>Hot → first call (avg)</dt><dd><Hours h={me.data?.data.hotToFirstCallHoursAvg} /></dd>
          </div>
        </Card>
      </div>
      <Card title="Ageing — longest in stage (working hours)" right={`bands: ${(ageing.data?.data.bands ?? []).join(" / ")} working days`}>
        <table className="w-full">
          <thead><tr><th className="th">Case</th><th className="th">Stage</th><th className="th">In stage</th><th className="th">Band</th></tr></thead>
          <tbody>
            {(ageing.data?.data.cases ?? []).slice(0, 12).map((c) => (
              <tr key={c.id} className="rowlink"><td className="td"><Link className="mono text-sky" href={`/cases/${c.id}`}>{c.caseNo}</Link></td><td className="td"><StageChip stage={c.stage} /></td><td className="td"><Hours h={c.inStageWorkingHours} /></td><td className="td mono">{c.band}</td></tr>
            ))}
            {ageing.data && ageing.data.data.cases.length === 0 && <tr><td className="td text-muted" colSpan={4}>No open cases.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
