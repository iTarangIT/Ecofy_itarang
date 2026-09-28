"use client";

// The always-visible "where is this case, whose turn is it, what do I do now"
// card at the top of a case. Replaces the old Current-step tab, the
// Case-timeline card and StepPanel: the stage rail, the party pill and the ONE
// form the case needs next all live here, so nobody hunts through tabs.
// Who-acts logic is the pure stepBrief(); the forms are the same components
// the tabs render, each gated by role and re-checked by the API.

import { useQuery } from "@tanstack/react-query";
import { get } from "@/lib/api";
import { fmtDateTime, type CaseSummary } from "@/lib/hooks";
import { railLabel, stepBrief, type StepBrief, type StepFacts, type StepTone } from "@/lib/stepBrief";
import { useSession } from "@/components/shell/Shell";
import { Hours, StageRail } from "@/components/ui/primitives";
import { AssessmentCard, NewAssessmentForm, type Assessment } from "./AssessmentTab";
import { EligibilityDecisionInline } from "./EligibilityDecisionInline";
import { DisbursementForm, DownPaymentForm, DownPaymentList, FinancingDecisionForm, ReacceptancePanel, isOpenDecision, type Decision, type PaymentStatus } from "./FinancingTab";
import { AppointmentCard, BookMeetingForm, DocumentUploadControl, LogActivityForm, type Appointment, type Doc } from "./FollowUpTabs";
import { CreateInstallationRow, InstallationSummary, InstallationUpdateForm, type Installation } from "./InstallationTab";
import { EligibilityRequestRow, OfferOtpBlock, QuoteCard, QuoteUploadForm, isActiveQuote, isLiveOffer, type Offer, type Quote } from "./OfferTab";
import { AdvanceButton, CloseRow, PickupAssignRow, QualifyPanel, ReassignRow, ReopenBlock, ReturnRow, RouteFinancierRow } from "./stepRows";

type P = { c: CaseSummary; onChange: () => void };
type Eligibility = { id: string; status: string; reason: string | null; requestedAt: string; decidedAt: string | null } | null;
type Otp = { challengeId: string };

const STAGE_LABEL: Record<string, string> = { S0: "Qualification", S1: "Pickup queue", S2: "Follow-up", S3: "Assessment", S4: "Offer", S5: "File", S6: "Financing", S7: "Installation", S8: "Asset", CLOSED: "Closed" };

const TONE: Record<StepTone, { card: string; bar: string; pill: string }> = {
  action: { card: "border-indigo-200 from-indigo-50/80", bar: "bg-gradient-to-b from-indigo-500 to-violet-500", pill: "bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm" },
  waiting: { card: "border-[#f0dcaf] from-warn-soft", bar: "bg-warn", pill: "bg-warn text-white" },
  done: { card: "border-line from-page", bar: "bg-silver", pill: "bg-navy text-white" },
};

export function CurrentStepCard({ c, onChange }: P) {
  const s = useSession();
  const st = c.stage;
  const ecofyRole = s.role === "ECOFY_ADMIN" || s.role === "ECOFY_USER";
  const itarang = s.role === "ITARANG_ADMIN" || s.role === "ITARANG_CALLER";

  // Only the reads this stage's brief needs; the keys are the tabs' keys, so nothing is fetched twice.
  const appointments = useQuery({ queryKey: ["appointments", c.id], queryFn: () => get<Appointment[]>(`/cases/${c.id}/appointments`), enabled: st === "S2" });
  const assessments = useQuery({ queryKey: ["assessments", c.id], queryFn: () => get<Assessment[]>(`/cases/${c.id}/assessments`), enabled: st === "S3" });
  const eligibility = useQuery({ queryKey: ["eligibility", c.id], queryFn: () => get<Eligibility>(`/cases/${c.id}/eligibility`), enabled: st === "S4" });
  const quotes = useQuery({ queryKey: ["quotes", c.id], queryFn: () => get<Quote[]>(`/cases/${c.id}/quotes`), enabled: st === "S4" });
  const offers = useQuery({ queryKey: ["offers", c.id], queryFn: () => get<Offer[]>(`/cases/${c.id}/offers`), enabled: st === "S4" });
  const decisions = useQuery({ queryKey: ["decisions", c.id], queryFn: () => get<Decision[]>(`/cases/${c.id}/financing/decisions`), enabled: st === "S6" });
  const reacceptancePending = st === "S6" && c.subStatus === "REACCEPTANCE_PENDING";
  const reacceptance = useQuery({ queryKey: ["reacceptance", c.id], queryFn: () => get<Otp | null>(`/cases/${c.id}/reacceptance`), enabled: reacceptancePending && (itarang || s.role === "ECOFY_ADMIN") });
  const installation = useQuery({ queryKey: ["installation", c.id], queryFn: () => get<Installation | null>(`/cases/${c.id}/installation`), enabled: st === "S6" || st === "S7" });
  const documents = useQuery({ queryKey: ["documents", c.id], queryFn: () => get<Doc[]>(`/cases/${c.id}/documents`), enabled: st === "S7" });
  const payment = useQuery({ queryKey: ["paystatus", c.id], queryFn: () => get<PaymentStatus>(`/cases/${c.id}/payment-status`), enabled: st === "S7" });
  const loading = [appointments, assessments, eligibility, quotes, offers, decisions, reacceptance, installation, documents, payment].some((q) => q.isLoading);

  const latestAssessment = assessments.data?.data[0];
  const facts: StepFacts = {
    completedMeeting: appointments.data?.data.some((a) => a.status === "COMPLETED"),
    scheduledMeeting: appointments.data?.data.some((a) => a.status === "SCHEDULED"),
    latestAssessment: latestAssessment ? { confirmed: Boolean(latestAssessment.confirmedAt) } : null,
    eligibility: eligibility.data?.data ?? null,
    activeQuote: quotes.data?.data.some(isActiveQuote),
    liveOffer: offers.data?.data.find(isLiveOffer) ?? null,
    reacceptanceLive: Boolean(reacceptance.data?.data),
    openDecision: decisions.data ? decisions.data.data.some(isOpenDecision) : undefined,
    installation: installation.data?.data ?? null,
    photos: documents.data?.data.filter((d) => d.typeCode === "INSTALLATION_PHOTO").length,
    letters: documents.data?.data.filter((d) => d.typeCode === "CUSTOMER_ACCEPTANCE_LETTER").length,
    downPaymentRecorded: payment.data?.data.downPaymentRecorded,
  };
  const brief: StepBrief = stepBrief({
    stage: st, subStatus: c.subStatus, owner: c.owner, financierName: c.financierName, hasFile: c.hasFile, temperature: c.temperature,
    role: s.role, userId: s.userId, assignedUserId: c.assignedUserId, assignedUserName: c.assignedUserName, facts,
  });
  const t = TONE[brief.tone];
  const inst = installation.data?.data ?? null;
  const activeQuote = quotes.data?.data.find((q) => q.status === "ACTIVE");
  const p = brief.primary;

  return (
    <section className={`relative overflow-hidden rounded-2xl border-2 bg-gradient-to-b to-white shadow-[var(--shadow-card)] ${t.card}`}>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1.5 ${t.bar}`} />
      <div className="space-y-4 px-5 py-4 pl-6">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.06em] ${t.pill}`}>{brief.partyLabel}</span>
            <span className="text-[13px]"><b>{st}</b> · {STAGE_LABEL[st] ?? st}{c.subStatus ? <span className="text-muted"> · {c.subStatus.replace(/_/g, " ").toLowerCase()}</span> : null}</span>
          </div>
          <span className="flex items-center gap-2 text-[12px] text-muted">In stage <Hours h={c.ageing.inStageWorkingHours} /> · open <Hours h={c.ageing.openWorkingHours} /></span>
        </header>

        <StageRail stage={st} tone={brief.tone} partyLabel={railLabel(brief)} />

        {st === "CLOSED" && <div className="banner banner-amber">Closed: {c.closureReason} {c.closureNote ? `— ${c.closureNote}` : ""} on {fmtDateTime(c.closedAt)}</div>}

        <div>
          <h3 className="text-[15px] font-bold text-ink">{brief.title}</h3>
          <p className="mt-0.5 text-[12.5px] text-ink/80">{brief.detail}</p>
          {brief.gate && <p className="mt-1 text-[12px] text-muted">{brief.gate}</p>}
          <p className="mt-1 text-[12px] font-semibold text-indigo-700">Next → {brief.next}</p>
        </div>

        {/* ---- the one thing to do now ---- */}
        <div className="card p-4">
          {loading ? (
            <div className="text-[12.5px] text-muted">Loading…</div>
          ) : (
            <div className="space-y-3">
              {p === "qualify" && (ecofyRole ? <QualifyPanel c={c} onChange={onChange} /> : <Waiting>Ecofy sets the temperature; Hot leads reach the pickup queue at once.</Waiting>)}
              {p === "pickup_assign" && (s.role === "ITARANG_ADMIN" ? <><PickupAssignRow c={c} onChange={onChange} /><ReturnRow c={c} onChange={onChange} /></> : <Waiting>iTarang Admin assigns a caller from the pickup queue.</Waiting>)}

              {p === "book_meeting" && (itarang ? <BookMeetingForm c={c} onChange={onChange} /> : <Waiting>The caller books the meeting.</Waiting>)}
              {p === "complete_meeting" && (
                <>
                  {(appointments.data?.data ?? []).filter((a) => a.status === "SCHEDULED").map((a) => <AppointmentCard key={a.id} c={c} a={a} onChange={onChange} />)}
                  {itarang && <details className="text-[12.5px]"><summary className="cursor-pointer text-muted">Book another meeting ▸</summary><div className="mt-2"><BookMeetingForm c={c} onChange={onChange} /></div></details>}
                </>
              )}
              {p === "advance" && (
                <div className="flex flex-wrap items-center gap-3">
                  <AdvanceButton c={c} onChange={onChange} />
                  <span className="text-[12px] text-muted">Completed: {(appointments.data?.data ?? []).filter((a) => a.status === "COMPLETED").map((a) => `${a.meetingType} ${fmtDateTime(a.actualAt ?? a.scheduledAt)}`).join(" · ")}</span>
                </div>
              )}

              {p === "new_assessment" && (itarang ? <NewAssessmentForm c={c} onChange={onChange} /> : <Waiting>The caller records the assessment.</Waiting>)}
              {p === "confirm_assessment" && latestAssessment && <AssessmentCard c={c} a={latestAssessment} latest onChange={onChange} />}

              {p === "send_eligibility" && (itarang ? <EligibilityRequestRow c={c} onChange={onChange} /> : <Waiting>The caller sends the case for eligibility.</Waiting>)}
              {p === "eligibility_decision" && (brief.tone === "action" ? <EligibilityDecisionInline c={c} onChange={onChange} /> : <Waiting>Sent for eligibility. You will be notified when it is decided.</Waiting>)}
              {p === "await_eligibility" && <Waiting>Sent for eligibility — waiting for the financier.</Waiting>}
              {p === "route_financier" && (s.role === "ITARANG_ADMIN" ? <RouteFinancierRow c={c} onChange={onChange} /> : <Waiting>iTarang Admin routes the case to the next financier.</Waiting>)}
              {p === "upload_quote" && (itarang ? <QuoteUploadForm c={c} onChange={onChange} /> : <Waiting>The caller uploads the EPC quote.</Waiting>)}
              {p === "compose_offer" && (activeQuote ? <QuoteCard c={c} q={activeQuote} onChange={onChange} /> : <Waiting>No ACTIVE quote.</Waiting>)}
              {(p === "send_otp" || p === "verify_otp") && (itarang ? <OfferOtpBlock c={c} onChange={onChange} /> : <Waiting>The caller sends the offer and enters the customer&apos;s OTP.</Waiting>)}
              {p === "verify_reacceptance" && (s.role === "ECOFY_ADMIN" ? <ReacceptancePanel c={c} onChange={onChange} /> : itarang ? <OfferOtpBlock c={c} onChange={onChange} /> : <Waiting>Waiting for the customer&apos;s re-acceptance OTP.</Waiting>)}
              {p === "trigger_reacceptance" && (s.role === "ECOFY_ADMIN" ? <ReacceptancePanel c={c} onChange={onChange} /> : <Waiting>Ecofy Admin triggers the re-acceptance OTP; the code is entered here once it is live.</Waiting>)}

              {(p === "financing_decision" || p === "await_decision") && (
                <>
                  {p === "financing_decision" && brief.tone === "action" ? <FinancingDecisionForm c={c} onChange={onChange} /> : <Waiting>{facts.openDecision === false ? "No decision is open with the financier yet." : "The financier is deciding. You will be notified on sanction or rejection."}</Waiting>}
                  {itarang && (
                    <details className="text-[12.5px]"><summary className="cursor-pointer text-muted">Installation can start in parallel ▸</summary>
                      <div className="mt-2 space-y-3">{inst ? <><InstallationSummary inst={inst} /><InstallationUpdateForm c={c} inst={inst} onChange={onChange} /></> : <CreateInstallationRow c={c} onChange={onChange} />}</div>
                    </details>
                  )}
                </>
              )}

              {p === "create_installation" && (itarang ? <CreateInstallationRow c={c} onChange={onChange} /> : <Waiting>The caller creates the installation record.</Waiting>)}
              {p === "installation_progress" && inst && (
                <>
                  <InstallationSummary inst={inst} />
                  <ProofChecklist photos={facts.photos ?? 0} letters={facts.letters ?? 0} />
                  {itarang && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <DocumentUploadControl c={c} onChange={onChange} fixedType="INSTALLATION_PHOTO" label="Installation photo" />
                      <DocumentUploadControl c={c} onChange={onChange} fixedType="CUSTOMER_ACCEPTANCE_LETTER" label="Customer acceptance letter" />
                    </div>
                  )}
                  <InstallationUpdateForm c={c} inst={inst} onChange={onChange} />
                  {s.role === "ECOFY_ADMIN" && <details className="text-[12.5px]"><summary className="cursor-pointer text-muted">Record the down payment received ▸</summary><div className="mt-2 space-y-2"><DownPaymentList c={c} /><DownPaymentForm c={c} onChange={onChange} /></div></details>}
                </>
              )}
              {p === "disbursement" && (
                <>
                  {inst && <InstallationSummary inst={inst} />}
                  {brief.tone === "action" ? <><DownPaymentList c={c} /><DownPaymentForm c={c} onChange={onChange} /><DisbursementForm c={c} onChange={onChange} /></> : <Waiting>The financier&apos;s admin records the down payment and the disbursement.</Waiting>}
                </>
              )}

              {(p === "reopen" || p === "new_linked_case") && <ReopenBlock c={c} onChange={onChange} />}
              {p === "none" && <Waiting>{brief.tone === "done" ? "Nothing to do on this case." : "Nothing to do for you right now."}</Waiting>}
            </div>
          )}
        </div>

        {/* ---- secondary, always reachable without leaving the card ---- */}
        {st !== "CLOSED" && (
          <div className="space-y-2 border-t border-line/70 pt-3">
            <details className="text-[12.5px]"><summary className="cursor-pointer font-semibold text-ink">{ecofyRole && st !== "S0" ? "Add a comment ▸" : "Log a call / remark / follow-up ▸"}</summary><div className="mt-2"><LogActivityForm c={c} onChange={onChange} /></div></details>
            {s.role === "ITARANG_ADMIN" && ["S2", "S3", "S4", "S5", "S6", "S7"].includes(st) && (
              <details className="text-[12.5px]"><summary className="cursor-pointer font-semibold text-ink">Reassign within iTarang ▸</summary><div className="mt-2"><ReassignRow c={c} onChange={onChange} /></div></details>
            )}
            {p !== "pickup_assign" && <ReturnRow c={c} onChange={onChange} />}
            <CloseRow c={c} onChange={onChange} />
          </div>
        )}
      </div>
    </section>
  );
}

function Waiting({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-muted">{children}</p>;
}

function ProofRow({ ok, label, n }: { ok: boolean; label: string; n: number }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`chip ${ok ? "bg-ecofy-soft text-ecofy" : "bg-warn-soft text-warn"}`}>{ok ? "✓" : "✗"}</span>
      <span>{label} <span className="text-muted">({n} uploaded)</span></span>
    </li>
  );
}

function ProofChecklist({ photos, letters }: { photos: number; letters: number }) {
  return (
    <ul className="space-y-1 text-[12.5px]">
      <ProofRow ok={photos >= 1} label="Installation photo" n={photos} />
      <ProofRow ok={letters >= 1} label="Customer acceptance letter" n={letters} />
    </ul>
  );
}
