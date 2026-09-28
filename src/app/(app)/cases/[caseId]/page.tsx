"use client";

import { use, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { get, ApiError, errorMessage } from "@/lib/api";
import { useCase, fmtDateTime, inr } from "@/lib/hooks";
import { useSession } from "@/components/shell/Shell";
import { Card, SegPill, StageChip, TempChip, Empty } from "@/components/ui/primitives";
import { CurrentStepCard } from "@/components/cases/CurrentStepCard";
import { ActivitiesTab, AppointmentsTab, DocumentsTab } from "@/components/cases/FollowUpTabs";
import { AssessmentTab } from "@/components/cases/AssessmentTab";
import { OfferTab } from "@/components/cases/OfferTab";
import { FinancingTab } from "@/components/cases/FinancingTab";
import { InstallationTab } from "@/components/cases/InstallationTab";
import { WithdrawalTab } from "@/components/cases/WithdrawalTab";

type TimelineItem = { at: string; kind: string; title: string; detail?: Record<string, unknown>; actor: { fullName: string; role: string | null } | null };
// History and full views. The current step is not a tab — it is the card above.
const TABS = ["Timeline", "Activities", "Appointments", "Assessment", "Offer", "Financing", "Installation", "Documents", "Withdrawal"] as const;

const KIND_CHIP: Array<[RegExp, string, string]> = [
  [/^stage/, "stage", "bg-navy text-white"],
  [/^activity/, "activity", "bg-chip text-teal"],
  [/^appointment/, "meeting", "bg-sky-soft text-sky"],
  [/^document/, "document", "bg-chip text-muted"],
  [/^assessment/, "assessment", "bg-epc-soft text-epc"],
  [/^eligibility|^quote|^offer/, "offer", "bg-warn-soft text-warn"],
  [/^file|^financing|^disbursement/, "financing", "bg-ecofy-soft text-ecofy"],
  [/^installation/, "installation", "bg-epc-soft text-epc"],
  [/^withdrawal/, "withdrawal", "bg-bad-soft text-bad"],
];
function kindChip(kind: string) {
  const hit = KIND_CHIP.find(([re]) => re.test(kind));
  return <span className={`chip ${hit?.[2] ?? "bg-chip text-muted"}`}>{hit?.[1] ?? kind}</span>;
}

/** Who actually acted — from the actor's role (ITARANG_* vs ECOFY_*), never from where the row was logged. */
type Party = "iTarang" | "Ecofy" | "Platform";
function partyOf(i: TimelineItem): Party {
  const role = i.actor?.role ?? "";
  return role.startsWith("ITARANG") ? "iTarang" : role.startsWith("ECOFY") ? "Ecofy" : "Platform";
}
const PARTY_CHIP: Record<Party, string> = { iTarang: "bg-sky-soft text-sky", Ecofy: "bg-ecofy-soft text-ecofy", Platform: "bg-chip text-muted" };

const flatDetail = (d?: Record<string, unknown>) =>
  d ? Object.entries(d).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(" · ") : "";

/** Timeline → CSV (Excel-friendly: BOM, CRLF, quoted cells) and trigger a download. */
function downloadTimelineCsv(fileStem: string, items: TimelineItem[]) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["When (IST)", "When (ISO)", "Party", "By", "Role", "Kind", "Event", "Details"];
  const rows = items.map((i) => [fmtDateTime(i.at), i.at, partyOf(i), i.actor?.fullName ?? "Platform", i.actor?.role ?? "", i.kind, i.title, flatDetail(i.detail)]);
  const csv = "\uFEFF" + [head, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileStem}-timeline.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 404 from GET /cases/{id} means "not in your scope" (RLS hides out-of-scope rows, BRD §2.2):
 * workers see cases assigned to them or qualified by them; Ecofy Admin sees a case only while Ecofy is
 * its lead source or current financier. Say so, per role, instead of a bare "not found".
 */
function HiddenCase({ role, error }: { role: string; error: unknown }) {
  const status = error instanceof ApiError ? error.status : undefined;
  if (status !== undefined && status !== 404) {
    return <div className="banner banner-red">Could not load this case: {errorMessage(error)}</div>;
  }
  const why =
    role === "ITARANG_CALLER" ? "You only see cases assigned to you. This one is not assigned to you yet — the iTarang Admin assigns cases from the Pickup queue."
    : role === "ECOFY_USER" ? "You only see cases you created or qualified, or that are assigned to you."
    : role === "ECOFY_ADMIN" ? "Ecofy Admin sees a case only while Ecofy is its lead source or its current financier."
    : "No case with this id exists in this workspace.";
  return (
    <div className="space-y-3">
      <div className="banner banner-red">This case is not visible to you.</div>
      <div className="card"><div className="card-b space-y-2 text-[13px]">
        <p>{why}</p>
        <p className="text-muted">If you were sent this link, ask the person who shared it to assign the case to you first.</p>
        <Link className="btn btn-sm" href="/leads">← My leads &amp; cases</Link>
      </div></div>
    </div>
  );
}

export default function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = use(params);
  const s = useSession();
  const qc = useQueryClient();
  const c = useCase(caseId);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Timeline");
  const tl = useQuery({ queryKey: ["timeline", caseId], queryFn: () => get<TimelineItem[]>(`/cases/${caseId}/timeline`), enabled: tab === "Timeline" });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["case", caseId] }); qc.invalidateQueries({ queryKey: ["timeline", caseId] }); };
  if (c.isLoading) return <div className="text-muted">Loading case…</div>;
  if (c.error || !c.data) return <HiddenCase role={s.role} error={c.error} />;
  const k = c.data.data;
  const timeline = (tl.data?.data ?? []).slice().reverse(); // the API is oldest-first; the reader wants the latest at the top

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <a className="text-[12.5px] text-sky" href="/leads">← Leads</a>
        <h2 className="text-[19px] font-bold">{k.customer?.fullName}</h2>
        <SegPill segment={k.segment} />
        <TempChip temperature={k.temperature} />
        <StageChip stage={k.stage} subStatus={k.subStatus} />
        <span className="mono text-[12px] text-muted">{k.caseNo}</span>
        {k.previousCaseId && <a className="text-[12px] text-sky" href={`/cases/${k.previousCaseId}`}>linked to previous case</a>}
      </div>

      <CurrentStepCard c={k} onChange={refresh} />

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1" aria-label="History">
            {TABS.map((t) => <button key={t} type="button" className={`btn btn-sm ${tab === t ? "btn-navy" : ""}`} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          {tab === "Timeline" && (
            <Card
              title="Timeline"
              right={
                <span className="flex items-center gap-3">
                  <span>everything recorded on the case · newest first</span>
                  <button type="button" className="btn btn-sm" disabled={tl.isLoading || timeline.length === 0} onClick={() => downloadTimelineCsv(k.caseNo || caseId, timeline)}>
                    ⤓ Download CSV
                  </button>
                </span>
              }
              pad={false}
            >
              {tl.isLoading && <Empty>Loading…</Empty>}
              {!tl.isLoading && timeline.length === 0 && <Empty>Nothing yet.</Empty>}
              {timeline.map((i, idx) => (
                <div key={idx} className="grid grid-cols-[130px_1fr] gap-3 border-b border-line px-4 py-2 text-[12.5px]">
                  <div className="mono text-[11.5px] text-muted">{fmtDateTime(i.at)}</div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`chip ${PARTY_CHIP[partyOf(i)]}`}>{partyOf(i)}</span>
                      {kindChip(i.kind)}
                      <span className="font-semibold">{i.title}</span>
                    </div>
                    {i.detail && Object.values(i.detail).some(Boolean) && <div className="text-muted">{flatDetail(i.detail)}</div>}
                    <div className="text-[11px] text-muted">by {i.actor?.fullName ?? "Platform"}</div>
                  </div>
                </div>
              ))}
            </Card>
          )}
          {tab === "Activities" && <ActivitiesTab c={k} onChange={refresh} />}
          {tab === "Appointments" && <AppointmentsTab c={k} onChange={refresh} />}
          {tab === "Assessment" && <AssessmentTab c={k} onChange={refresh} />}
          {tab === "Offer" && <OfferTab c={k} onChange={refresh} />}
          {tab === "Financing" && <FinancingTab c={k} onChange={refresh} />}
          {tab === "Installation" && <InstallationTab c={k} onChange={refresh} />}
          {tab === "Documents" && <DocumentsTab c={k} onChange={refresh} />}
          {tab === "Withdrawal" && <WithdrawalTab c={k} onChange={refresh} />}
        </div>
        <div className="space-y-4">
          <Card title="Customer">
            <dl className="kv">
              <dt>Mobile</dt><dd className="mono">{k.customer?.mobile} {k.customer?.altMobile ? `/ ${k.customer.altMobile}` : ""}</dd>
              <dt>Email</dt><dd>{k.customer?.email ?? "—"}</dd>
              <dt>Type</dt><dd>{k.customer?.customerType}{k.customer?.businessName ? ` · ${k.customer.businessName}` : ""}</dd>
              <dt>Address</dt><dd>{k.customer?.address}, {k.customer?.city}, {k.customer?.state} {k.customer?.pincode}</dd>
              <dt>Language</dt><dd>{k.customer?.preferredLanguage ?? "—"}</dd>
              <dt>Property</dt><dd>{k.customer?.propertyType ?? "—"}</dd>
              <dt>Consent</dt><dd>{k.customer?.consentSource} · {k.customer?.consentDate}</dd>
            </dl>
          </Card>
          <Card title="Lead details">
            <dl className="kv">
              <dt>Source</dt><dd>{k.source} · owner {k.owner === "ECOFY" ? "Ecofy" : "iTarang"}</dd>
              <dt>Product interest</dt><dd>{k.productInterest ?? "—"}</dd>
              <dt>Avg monthly bill</dt><dd>{inr(k.avgMonthlyBillInr)}</dd>
              <dt>Sanctioned load</dt><dd>{k.sanctionedLoadKw ?? "—"} kW</dd>
              <dt>Existing backup</dt><dd>{k.existingBackup ?? "—"}</dd>
              <dt>Call time</dt><dd>{k.preferredCallTime ?? "—"}</dd>
              <dt>Ecofy lead id</dt><dd className="mono">{k.ecofyLeadId ?? "—"}</dd>
              <dt>Qualified by</dt><dd>{k.qualifiedByName ?? "—"}</dd>
              <dt>Financier</dt><dd>{k.financierName ?? "—"}</dd>
              <dt>Created</dt><dd>{fmtDateTime(k.createdAt)}</dd>
            </dl>
          </Card>
          {s.role === "ECOFY_USER" && k.stage !== "S0" && <div className="banner banner-amber">After handoff, Ecofy users can add comments only; the stage is with iTarang.</div>}
        </div>
      </div>
    </div>
  );
}
