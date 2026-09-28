// "Whose turn is it, what do I do now, what comes next" for one case, as seen
// by one signed-in role. Pure: no React, no fetch — the CurrentStepCard feeds
// it the case fields plus the live facts it has loaded; tests/unit tables it.
//
// The case DTO carries no "who acts next" field, so this derives it from
// stage × sub-status × facts (BRD §4.2 transitions, sub-statuses from the
// m07/m09/m10/m11/m12 services). The API still re-checks every gate.

import type { Role } from "@/core/auth/rbac";

export type StepParty = "ecofy_admin" | "ecofy_user" | "itarang_admin" | "caller" | "epc" | "customer";
export type StepTone = "action" | "waiting" | "done";

export type StepPrimary =
    | "none"
    | "qualify"
    | "pickup_assign"
    | "book_meeting"
    | "complete_meeting"
    | "advance"
    | "new_assessment"
    | "confirm_assessment"
    | "send_eligibility"
    | "eligibility_decision"
    | "await_eligibility"
    | "route_financier"
    | "upload_quote"
    | "compose_offer"
    | "send_otp"
    | "verify_otp"
    | "trigger_reacceptance"
    | "verify_reacceptance"
    | "financing_decision"
    | "await_decision"
    | "create_installation"
    | "installation_progress"
    | "disbursement"
    | "reopen"
    | "new_linked_case";

/** Live facts the card has loaded. Everything optional — unknown counts as "none yet". */
export interface StepFacts {
    completedMeeting?: boolean;
    scheduledMeeting?: boolean;
    latestAssessment?: { confirmed: boolean } | null;
    /** GET /cases/{id}/eligibility — the latest check, or null when never sent. */
    eligibility?: { status: string; reason?: string | null } | null;
    activeQuote?: boolean;
    liveOffer?: { status: string } | null;
    reacceptanceLive?: boolean;
    openDecision?: boolean;
    installation?: { status: string } | null;
    photos?: number;
    letters?: number;
    downPaymentRecorded?: boolean;
}

export interface StepBriefInput {
    stage: string | null;
    subStatus: string | null;
    /** Lead source: "ECOFY" | "ITARANG". */
    owner: string | null;
    financierName: string | null;
    hasFile: boolean;
    temperature: string | null;
    role: Role;
    userId: string;
    assignedUserId: string | null;
    /** Shown only for Ecofy-side assignees (S0). At S2+ the assignee is the CRM integration user — never named (D1). */
    assignedUserName: string | null;
    facts: StepFacts;
}

export interface StepBrief {
    title: string;
    detail: string;
    next: string;
    gate?: string;
    party: StepParty;
    /** "Your action" · "Pending from iTarang" · "Pending from Ecofy" · "With the EPC partner" · "Waiting for the customer's OTP" … */
    partyLabel: string;
    tone: StepTone;
    primary: StepPrimary;
}

/** The seeded financier is "Ecofy"; a null financier means the default, which is Ecofy. Other lenders are recorded by iTarang Admin. */
export function isEcofyFinancier(name: string | null | undefined): boolean {
    return !name || /ecofy/i.test(name);
}

type Draft = Omit<StepBrief, "party" | "partyLabel" | "tone"> & { who: StepParty; done?: boolean };

export function stepBrief(i: StepBriefInput): StepBrief {
    return resolve(i, draft(i));
}

function draft(i: StepBriefInput): Draft {
    const f = i.facts;
    const sub = i.subStatus ?? "";
    const ecofyLender = isEcofyFinancier(i.financierName);
    const lender = ecofyLender ? "Ecofy" : i.financierName ?? "the financier";
    const financierParty: StepParty = ecofyLender ? "ecofy_admin" : "itarang_admin";

    switch (i.stage) {
        case "S0":
            return {
                who: i.assignedUserId ? "ecofy_user" : "ecofy_admin",
                title: i.temperature === "WARM" ? "Warm lead — push to iTarang when ready" : "Qualify the lead — set the temperature",
                detail:
                    i.temperature === "WARM"
                        ? "The lead stays with Ecofy until pushed. Push it to the iTarang pickup queue, or mark it Hot to move it at once."
                        : "Hot moves the case to the iTarang queue at once; Warm stays with Ecofy until pushed; Not interested closes with a reason.",
                next: "Pickup queue (S1): iTarang Admin assigns a caller.",
                primary: "qualify",
            };

        case "S1":
            return {
                who: "itarang_admin",
                title: "Pick up and assign a caller",
                detail: "New in the pickup queue. Assigning a caller moves the case to follow-up (S2); or return it to Ecofy with a reason.",
                next: "Follow-up (S2): the caller phones the customer and books a meeting.",
                primary: "pickup_assign",
            };

        case "S2": {
            const next = "Assessment (S3) — the sizing is recorded once a meeting or EPC visit is completed.";
            if (f.completedMeeting) return { who: "caller", title: "Advance to assessment", detail: "A meeting is completed, so the gate to S3 is met.", next, gate: "Gate met: at least one completed meeting or EPC visit.", primary: "advance" };
            if (f.scheduledMeeting) return { who: "caller", title: "Complete the scheduled meeting", detail: "After the meeting, mark it completed with the actual time and remarks (or no-show / reschedule).", next, gate: "Gate to S3: one completed meeting or EPC visit.", primary: "complete_meeting" };
            return { who: "caller", title: "Call the customer and book a meeting", detail: "Log the call, then book a phone / video / site meeting or an EPC visit.", next, gate: "Gate to S3: one completed meeting or EPC visit.", primary: "book_meeting" };
        }

        case "S3": {
            const next = "Offer (S4) — eligibility with the financier, then the EPC quote and the customer OTP.";
            if (f.latestAssessment && !f.latestAssessment.confirmed) return { who: "caller", title: "Confirm the assessment", detail: "The latest assessment is saved but not confirmed. Confirming moves the case to the offer stage.", next, primary: "confirm_assessment" };
            return { who: "caller", title: "Record the assessment", detail: "Size the system with the calculator, or record a manual / EPC sizing; then confirm it.", next, gate: "Gate to S4: one confirmed assessment.", primary: "new_assessment" };
        }

        case "S4": {
            if (sub === "NOT_ELIGIBLE") return { who: "itarang_admin", title: `Not eligible with ${lender} — route to the next financier`, detail: "Pick another financier and note why; eligibility is then requested from them.", next: "Eligibility with the next financier, then EPC quote → offer → OTP.", primary: "route_financier" };
            if (sub === "QUOTE_PENDING") return { who: "caller", title: "Upload the EPC quote (PDF)", detail: "Eligible. Upload the EPC partner's quote with its prices; it becomes the ACTIVE quote.", next: "Compose the offer from the ACTIVE quote, then send the customer OTP (S5).", primary: "upload_quote" };
            if (sub === "OFFER_READY") {
                if (f.liveOffer) return { who: "caller", title: "Send the offer — SMS OTP to the customer", detail: "The offer is composed. Sending it texts the customer a 6-digit OTP and moves the case to S5.", next: "File (S5): enter the customer's OTP to lock the File.", primary: "send_otp" };
                if (f.activeQuote) return { who: "caller", title: "Compose the offer from the ACTIVE quote", detail: "Eligibility and quote are in. Compose the offer (no EMI, no price override).", next: "Send the offer → customer OTP (S5).", primary: "compose_offer" };
                return { who: "caller", title: "Upload the EPC quote (PDF)", detail: "Eligible, but no ACTIVE quote yet. Upload the EPC partner's quote.", next: "Compose the offer, then send the customer OTP (S5).", primary: "upload_quote" };
            }
            // ELIGIBILITY_PENDING — also the entry sub-status of S4, before anyone asked
            const e = f.eligibility ?? null;
            if (e?.status === "REQUESTED") {
                return {
                    who: financierParty,
                    title: `${lender} decides eligibility`,
                    detail: ecofyLender ? "Sent for eligibility. Ecofy Admin records Eligible (maximum amount, hidden from callers), Not eligible or Info needed." : `Sent for eligibility. iTarang Admin records ${lender}'s answer.`,
                    next: "Once eligible: EPC quote → offer → customer OTP (S5).",
                    primary: "eligibility_decision",
                };
            }
            if (e?.status === "INFO_NEEDED") {
                return { who: "caller", title: `${lender} needs more information`, detail: e.reason ? `Note from the financier: ${e.reason}` : "The financier asked for more information. Answer it and send for eligibility again.", next: "Send for eligibility again; once eligible: EPC quote → offer → OTP.", primary: "send_eligibility" };
            }
            return { who: "caller", title: "Send for eligibility", detail: `Ask ${lender} whether the customer is eligible. The quote and offer follow.`, next: `${lender} answers; then EPC quote → offer → customer OTP (S5).`, primary: "send_eligibility" };
        }

        case "S5":
            return { who: "customer", title: "Enter the customer's OTP", detail: "The offer went out by SMS. Type the 6-digit code the customer reads out; on success the File is created and locked.", next: "Financing (S6) — the File goes to the financier for a decision.", gate: "OTP: 6 digits · 5 attempts · 10 minutes. Resend if it expired.", primary: "verify_otp" };

        case "S6": {
            if (sub === "REACCEPTANCE_PENDING") {
                if (f.reacceptanceLive) return { who: "customer", title: "Re-acceptance OTP — enter the customer's code", detail: "The customer received an OTP with the revised amounts. Enter the code the customer reads out to confirm the revised terms.", next: "Revised terms confirmed → Installation (S7).", primary: "verify_reacceptance" };
                return { who: "ecofy_admin", title: "Sanction below the accepted total — trigger the re-acceptance OTP", detail: "Ecofy Admin sends the customer an OTP carrying the financed amount and down payment (built from the sanction values).", next: "Customer confirms the revised terms → Installation (S7).", primary: "trigger_reacceptance" };
            }
            if (sub === "REJECTED_ROUTING") return { who: "itarang_admin", title: `Rejected by ${lender} — route to the next financier`, detail: "Pick another financier and note why, or close as rejected by all financiers.", next: "The next financier decides; a sanction moves the case to Installation (S7).", primary: "route_financier" };
            return {
                who: financierParty,
                title: `File locked — ${lender} decides`,
                detail: ecofyLender ? "Ecofy Admin records the sanction or rejection. Installation may be created in parallel (with a warning while no sanction is recorded)." : `iTarang Admin records ${lender}'s sanction or rejection. Installation may be created in parallel.`,
                next: "Sanction → Installation (S7). A lower sanction → re-acceptance OTP. Rejection → next financier.",
                primary: f.openDecision === false ? "await_decision" : "financing_decision",
            };
        }

        case "S7": {
            const inst = f.installation ?? null;
            if (!inst) return { who: "caller", title: "Create the installation", detail: "Sanction recorded. Pick the EPC partner who installs and, if known, the scheduled date.", next: "EPC installs; photos + acceptance letter → INSTALLED → disbursement → Asset (S8).", primary: "create_installation" };
            if (inst.status === "INSTALLED" || inst.status === "COMMISSIONED") {
                return {
                    who: financierParty,
                    title: "Installed — record the disbursement",
                    detail: ecofyLender ? "Ecofy Admin records the down payment received and the disbursement; that moves the case to Asset (S8)." : "iTarang Admin records the down payment and the disbursement; that moves the case to Asset (S8).",
                    next: "Asset (S8): EMI status, buyback and redeployment are recorded by Ecofy.",
                    gate: f.downPaymentRecorded === false ? "Down payment not recorded yet." : undefined,
                    primary: "disbursement",
                };
            }
            const photos = f.photos ?? 0;
            const letters = f.letters ?? 0;
            return {
                who: "epc",
                title: `Installation ${inst.status.replace(/_/g, " ").toLowerCase()} — record progress`,
                detail: "The EPC partner installs. Update the status here as it progresses.",
                next: "INSTALLED → disbursement → Asset (S8).",
                gate:
                    photos >= 1 && letters >= 1
                        ? "Proof uploaded: installation photo and customer acceptance letter."
                        : `Before INSTALLED, upload ${photos < 1 ? "an installation photo" : ""}${photos < 1 && letters < 1 ? " and " : ""}${letters < 1 ? "the customer acceptance letter" : ""}.`,
                primary: "installation_progress",
            };
        }

        case "S8":
            return { who: "ecofy_admin", done: true, title: "Asset active — disbursed", detail: "EMI status, buyback and redeployment are recorded by Ecofy Admin under Assets. After-sales stays outside the platform.", next: "Nothing further on the case.", primary: "none" };

        case "CLOSED":
            return {
                who: "itarang_admin",
                done: true,
                title: "Closed",
                detail: i.hasFile ? "The case reached a File, so it cannot reopen — start a new linked case for the customer instead." : "The case can be reopened; it returns to S0 with Ecofy.",
                next: i.hasFile ? "A new linked case starts at intake." : "Reopen → Ecofy re-qualifies (S0).",
                primary: i.hasFile ? "new_linked_case" : "reopen",
            };

        default:
            return { who: "ecofy_admin", title: "Waiting", detail: "The stage is not known yet.", next: "—", primary: "none" };
    }
}

/** Which signed-in roles may act for a party (the API is the real gate). */
function actors(party: StepParty): Role[] {
    switch (party) {
        case "ecofy_admin":
            return ["ECOFY_ADMIN"];
        case "ecofy_user":
            return ["ECOFY_USER", "ECOFY_ADMIN"];
        case "itarang_admin":
            return ["ITARANG_ADMIN"];
        case "caller":
        case "epc":
            return ["ITARANG_CALLER", "ITARANG_ADMIN"];
        case "customer":
            return ["ITARANG_CALLER", "ITARANG_ADMIN"];
    }
}

function resolve(i: StepBriefInput, d: Draft): StepBrief {
    const base = { title: d.title, detail: d.detail, next: d.next, gate: d.gate, primary: d.primary };
    const ecofyRole = i.role === "ECOFY_ADMIN" || i.role === "ECOFY_USER";

    if (d.done) {
        if (i.stage === "CLOSED") {
            // CONFLICTS #29: Ecofy roles and iTarang Admin may reopen / start a linked case; callers only read.
            const mayReopen = ecofyRole || i.role === "ITARANG_ADMIN";
            return { ...base, primary: mayReopen ? d.primary : "none", party: "itarang_admin", partyLabel: "Closed", tone: "done" };
        }
        return { ...base, party: d.who, partyLabel: "Done — with Ecofy", tone: "done" };
    }

    // CONFLICTS #28: Ecofy Admin may verify the re-acceptance OTP in place too.
    const mine = actors(d.who).includes(i.role) || (d.primary === "verify_reacceptance" && i.role === "ECOFY_ADMIN");
    const isAssignee = Boolean(i.assignedUserId) && i.assignedUserId === i.userId;

    // Ecofy User after handoff: comments only (page banner) — never an action.
    if (i.role === "ECOFY_USER" && i.stage !== "S0") return { ...base, primary: "none", party: d.who, partyLabel: waitingLabel(d.who), tone: "waiting" };

    if (!mine) return { ...base, party: d.who, partyLabel: waitingLabel(d.who), tone: "waiting" };

    switch (d.who) {
        case "ecofy_user":
            if (isAssignee) return { ...base, party: d.who, partyLabel: "Your action", tone: "action" };
            if (i.role === "ECOFY_ADMIN") return { ...base, party: d.who, partyLabel: i.assignedUserName ? `With ${i.assignedUserName} · you can also act` : "Your action", tone: "action" };
            return { ...base, party: d.who, partyLabel: waitingLabel(d.who), tone: "waiting" };
        case "caller":
        case "epc":
            if (i.role === "ITARANG_CALLER" && !isAssignee) return { ...base, party: d.who, partyLabel: waitingLabel(d.who), tone: "waiting" };
            if (i.role === "ITARANG_ADMIN" && !isAssignee && i.assignedUserId) {
                return { ...base, party: d.who, partyLabel: d.who === "epc" ? "With the EPC partner · you can record progress" : "With the caller · you can also act", tone: "action" };
            }
            return { ...base, party: d.who, partyLabel: d.who === "epc" ? "With the EPC partner · you record progress" : "Your action", tone: "action" };
        case "customer":
            return { ...base, party: d.who, partyLabel: "Waiting for the customer's OTP · you enter it", tone: "action" };
        default:
            return { ...base, party: d.who, partyLabel: "Your action", tone: "action" };
    }
}

function waitingLabel(p: StepParty): string {
    switch (p) {
        case "ecofy_admin":
        case "ecofy_user":
            return "Pending from Ecofy";
        case "itarang_admin":
        case "caller":
            return "Pending from iTarang";
        case "epc":
            return "With the EPC partner";
        case "customer":
            return "Waiting for the customer's OTP";
    }
}

/** Short pill under the rail's current node. */
export function railLabel(b: StepBrief): string {
    if (b.tone === "done") return "Done";
    if (b.tone === "action") return "You are here";
    switch (b.party) {
        case "ecofy_admin":
        case "ecofy_user":
            return "Pending: Ecofy";
        case "itarang_admin":
        case "caller":
            return "Pending: iTarang";
        case "epc":
            return "With EPC";
        case "customer":
            return "Customer OTP";
    }
}
