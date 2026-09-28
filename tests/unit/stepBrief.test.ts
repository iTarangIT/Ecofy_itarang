import { describe, it, expect } from "vitest";
import { isEcofyFinancier, railLabel, stepBrief, type StepBriefInput } from "@/lib/stepBrief";

const base: StepBriefInput = {
  stage: "S2", subStatus: null, owner: "ECOFY", financierName: "Ecofy", hasFile: false, temperature: "HOT",
  role: "ITARANG_CALLER", userId: "u-caller", assignedUserId: "u-caller", assignedUserName: "iTarang team", facts: {},
};
const as = (role: StepBriefInput["role"], over: Partial<StepBriefInput> = {}) => stepBrief({ ...base, role, userId: role === "ITARANG_CALLER" ? "u-caller" : `u-${role}`, ...over });

describe("stepBrief — whose turn, per role (BRD §4.2)", () => {
  it("S0 belongs to Ecofy: the assigned Ecofy User acts, Ecofy Admin may also act, iTarang waits", () => {
    const s0 = { stage: "S0", assignedUserId: "u-ECOFY_USER", assignedUserName: "Priya", temperature: null } as Partial<StepBriefInput>;
    expect(as("ECOFY_USER", s0)).toMatchObject({ party: "ecofy_user", partyLabel: "Your action", tone: "action", primary: "qualify" });
    expect(as("ECOFY_ADMIN", s0)).toMatchObject({ partyLabel: "With Priya · you can also act", tone: "action", primary: "qualify" });
    expect(as("ECOFY_ADMIN", { ...s0, assignedUserId: null, assignedUserName: null })).toMatchObject({ party: "ecofy_admin", partyLabel: "Your action" });
    expect(as("ITARANG_ADMIN", s0)).toMatchObject({ partyLabel: "Pending from Ecofy", tone: "waiting" });
    expect(as("ITARANG_CALLER", s0)).toMatchObject({ partyLabel: "Pending from Ecofy", tone: "waiting" });
    expect(as("ECOFY_USER", { ...s0, temperature: "WARM" }).title).toMatch(/push to iTarang/);
  });

  it("S1 is iTarang Admin's; Ecofy sees 'Pending from iTarang' and a caller waits too", () => {
    expect(as("ITARANG_ADMIN", { stage: "S1", assignedUserId: null })).toMatchObject({ party: "itarang_admin", partyLabel: "Your action", tone: "action", primary: "pickup_assign" });
    expect(as("ECOFY_ADMIN", { stage: "S1", assignedUserId: null })).toMatchObject({ partyLabel: "Pending from iTarang", tone: "waiting", primary: "pickup_assign" });
    expect(as("ITARANG_CALLER", { stage: "S1", assignedUserId: null })).toMatchObject({ partyLabel: "Pending from iTarang", tone: "waiting" });
  });

  it("Ecofy User after handoff is comment-only: waiting, never a form (D1: no CRM name)", () => {
    const b = as("ECOFY_USER", { stage: "S2", assignedUserId: "u-caller", assignedUserName: "anirudh singhal" });
    expect(b).toMatchObject({ tone: "waiting", primary: "none", partyLabel: "Pending from iTarang" });
    expect(b.partyLabel).not.toMatch(/anirudh/);
  });

  it("S2 walks book → complete → advance for the assigned caller; iTarang Admin can also act", () => {
    expect(as("ITARANG_CALLER").primary).toBe("book_meeting");
    expect(as("ITARANG_CALLER", { facts: { scheduledMeeting: true } }).primary).toBe("complete_meeting");
    const adv = as("ITARANG_CALLER", { facts: { completedMeeting: true } });
    expect(adv).toMatchObject({ primary: "advance", partyLabel: "Your action" });
    expect(adv.gate).toMatch(/Gate met/);
    expect(as("ITARANG_ADMIN")).toMatchObject({ partyLabel: "With the caller · you can also act", tone: "action" });
    expect(as("ITARANG_ADMIN", { assignedUserId: "u-ITARANG_ADMIN" }).partyLabel).toBe("Your action");
    expect(as("ITARANG_CALLER", { assignedUserId: "someone-else" })).toMatchObject({ partyLabel: "Pending from iTarang", tone: "waiting" });
    expect(as("ECOFY_ADMIN")).toMatchObject({ partyLabel: "Pending from iTarang", tone: "waiting" });
  });

  it("S3 asks for an assessment, then its confirmation", () => {
    expect(as("ITARANG_CALLER", { stage: "S3", facts: { latestAssessment: null } }).primary).toBe("new_assessment");
    expect(as("ITARANG_CALLER", { stage: "S3", facts: { latestAssessment: { confirmed: false } } }).primary).toBe("confirm_assessment");
  });

  it("S4 eligibility: send → financier decides (Ecofy Admin inline) → info needed goes back to the caller", () => {
    const s4 = { stage: "S4", subStatus: "ELIGIBILITY_PENDING" } as Partial<StepBriefInput>;
    expect(as("ITARANG_CALLER", { ...s4, facts: { eligibility: null } })).toMatchObject({ primary: "send_eligibility", tone: "action" });
    const requested = { ...s4, facts: { eligibility: { status: "REQUESTED" } } };
    expect(as("ECOFY_ADMIN", requested)).toMatchObject({ party: "ecofy_admin", partyLabel: "Your action", tone: "action", primary: "eligibility_decision" });
    expect(as("ITARANG_CALLER", requested)).toMatchObject({ partyLabel: "Pending from Ecofy", tone: "waiting", primary: "eligibility_decision" });
    expect(as("ITARANG_ADMIN", { ...requested, financierName: "Bajaj" })).toMatchObject({ party: "itarang_admin", partyLabel: "Your action", primary: "eligibility_decision" });
    expect(as("ECOFY_ADMIN", { ...requested, financierName: "Bajaj" })).toMatchObject({ partyLabel: "Pending from iTarang", tone: "waiting" });
    const info = as("ITARANG_CALLER", { ...s4, facts: { eligibility: { status: "INFO_NEEDED", reason: "Need the bill" } } });
    expect(info).toMatchObject({ primary: "send_eligibility", tone: "action" });
    expect(info.detail).toMatch(/Need the bill/);
  });

  it("S4 NOT_ELIGIBLE routes (iTarang Admin); QUOTE_PENDING uploads; OFFER_READY composes then sends", () => {
    expect(as("ITARANG_CALLER", { stage: "S4", subStatus: "NOT_ELIGIBLE" })).toMatchObject({ primary: "route_financier", partyLabel: "Pending from iTarang", tone: "waiting" });
    expect(as("ITARANG_ADMIN", { stage: "S4", subStatus: "NOT_ELIGIBLE" })).toMatchObject({ primary: "route_financier", tone: "action" });
    expect(as("ITARANG_CALLER", { stage: "S4", subStatus: "QUOTE_PENDING" }).primary).toBe("upload_quote");
    expect(as("ITARANG_CALLER", { stage: "S4", subStatus: "OFFER_READY", facts: { activeQuote: false } }).primary).toBe("upload_quote");
    expect(as("ITARANG_CALLER", { stage: "S4", subStatus: "OFFER_READY", facts: { activeQuote: true, liveOffer: null } }).primary).toBe("compose_offer");
    expect(as("ITARANG_CALLER", { stage: "S4", subStatus: "OFFER_READY", facts: { activeQuote: true, liveOffer: { status: "DRAFT" } } }).primary).toBe("send_otp");
  });

  it("S5 waits on the customer's OTP, entered by the caller", () => {
    expect(as("ITARANG_CALLER", { stage: "S5", subStatus: "OTP_SENT" })).toMatchObject({ party: "customer", partyLabel: "Waiting for the customer's OTP · you enter it", tone: "action", primary: "verify_otp" });
    expect(as("ECOFY_ADMIN", { stage: "S5", subStatus: "OTP_SENT" })).toMatchObject({ partyLabel: "Waiting for the customer's OTP", tone: "waiting" });
  });

  it("S6: Ecofy Admin decides (form only while a decision is open); re-acceptance trigger then verify; rejection routes", () => {
    const s6 = { stage: "S6", subStatus: "AWAITING_DECISION" } as Partial<StepBriefInput>;
    expect(as("ECOFY_ADMIN", { ...s6, facts: { openDecision: true } })).toMatchObject({ partyLabel: "Your action", primary: "financing_decision" });
    expect(as("ECOFY_ADMIN", { ...s6, facts: { openDecision: false } }).primary).toBe("await_decision");
    expect(as("ITARANG_CALLER", { ...s6, facts: { openDecision: true } })).toMatchObject({ partyLabel: "Pending from Ecofy", tone: "waiting" });
    expect(as("ITARANG_ADMIN", { ...s6, financierName: "Bajaj", facts: { openDecision: true } })).toMatchObject({ partyLabel: "Your action", primary: "financing_decision" });
    const re = { stage: "S6", subStatus: "REACCEPTANCE_PENDING" } as Partial<StepBriefInput>;
    expect(as("ECOFY_ADMIN", { ...re, facts: { reacceptanceLive: false } })).toMatchObject({ primary: "trigger_reacceptance", tone: "action" });
    expect(as("ITARANG_CALLER", { ...re, facts: { reacceptanceLive: false } })).toMatchObject({ primary: "trigger_reacceptance", partyLabel: "Pending from Ecofy" });
    expect(as("ITARANG_CALLER", { ...re, facts: { reacceptanceLive: true } })).toMatchObject({ primary: "verify_reacceptance", tone: "action" });
    expect(as("ECOFY_ADMIN", { ...re, facts: { reacceptanceLive: true } })).toMatchObject({ primary: "verify_reacceptance", tone: "action" });
    expect(as("ITARANG_ADMIN", { stage: "S6", subStatus: "REJECTED_ROUTING" })).toMatchObject({ primary: "route_financier", tone: "action" });
  });

  it("S7: create → progress with the proof gate → disbursement by the financier's admin", () => {
    expect(as("ITARANG_CALLER", { stage: "S7", subStatus: "INSTALLING", facts: { installation: null } }).primary).toBe("create_installation");
    const prog = as("ITARANG_CALLER", { stage: "S7", subStatus: "INSTALLING", facts: { installation: { status: "IN_PROGRESS" }, photos: 0, letters: 0 } });
    expect(prog).toMatchObject({ party: "epc", primary: "installation_progress", tone: "action", partyLabel: "With the EPC partner · you record progress" });
    expect(prog.gate).toBe("Before INSTALLED, upload an installation photo and the customer acceptance letter.");
    expect(as("ECOFY_ADMIN", { stage: "S7", subStatus: "INSTALLING", facts: { installation: { status: "IN_PROGRESS" }, photos: 1, letters: 1 } })).toMatchObject({ partyLabel: "With the EPC partner", tone: "waiting" });
    expect(as("ECOFY_ADMIN", { stage: "S7", subStatus: "INSTALLED", facts: { installation: { status: "INSTALLED" }, downPaymentRecorded: false } })).toMatchObject({ primary: "disbursement", partyLabel: "Your action", gate: "Down payment not recorded yet." });
    expect(as("ITARANG_CALLER", { stage: "S7", subStatus: "INSTALLED", facts: { installation: { status: "COMMISSIONED" } } })).toMatchObject({ primary: "disbursement", partyLabel: "Pending from Ecofy", tone: "waiting" });
  });

  it("S8 is done; CLOSED reopens for Ecofy roles and iTarang Admin, never for a caller; a File forces a linked case", () => {
    expect(as("ITARANG_CALLER", { stage: "S8" })).toMatchObject({ tone: "done", primary: "none", partyLabel: "Done — with Ecofy" });
    expect(as("ECOFY_USER", { stage: "CLOSED" })).toMatchObject({ tone: "done", primary: "reopen" });
    expect(as("ITARANG_ADMIN", { stage: "CLOSED", hasFile: true })).toMatchObject({ tone: "done", primary: "new_linked_case" });
    expect(as("ITARANG_CALLER", { stage: "CLOSED" })).toMatchObject({ tone: "done", primary: "none" });
  });

  it("helpers: financier heuristic and rail pill", () => {
    expect(isEcofyFinancier(null)).toBe(true);
    expect(isEcofyFinancier("Ecofy Green")).toBe(true);
    expect(isEcofyFinancier("Bajaj")).toBe(false);
    expect(railLabel(as("ITARANG_CALLER"))).toBe("You are here");
    expect(railLabel(as("ECOFY_ADMIN"))).toBe("Pending: iTarang");
    expect(railLabel(as("ITARANG_CALLER", { stage: "S4", subStatus: "ELIGIBILITY_PENDING", facts: { eligibility: { status: "REQUESTED" } } }))).toBe("Pending: Ecofy");
    expect(railLabel(as("ITARANG_CALLER", { stage: "S8" }))).toBe("Done");
  });
});
