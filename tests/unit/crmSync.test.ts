import { describe, it, expect } from "vitest";
import { sign, verify, apiSigningString } from "@/core/auth/hmac";
import { crmEventFor } from "@/modules/m18-crm-sync/outbound";
import { CrmInboundEvent } from "@/modules/m18-crm-sync/inbound";

const SECRET = "unit-secret-unit-secret-unit-secret-0123";

describe("CRM sync — signature", () => {
  const body = JSON.stringify({ eventId: "e1", type: "lead.pushed" });
  const at = new Date("2026-09-24T10:00:00Z");

  it("verifies its own signature within the tolerance window", () => {
    const h = sign(SECRET, body, at);
    expect(h).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verify(SECRET, h, body, new Date(at.getTime() + 299_000))).toBe(true);
  });

  it("rejects a changed body, another secret, an old timestamp and malformed headers", () => {
    const h = sign(SECRET, body, at);
    expect(verify(SECRET, h, body.replace("e1", "e2"), at)).toBe(false);
    expect(verify(SECRET + "x", h, body, at)).toBe(false);
    expect(verify(SECRET, h, body, new Date(at.getTime() + 301_000))).toBe(false);
    expect(verify(SECRET, null, body, at)).toBe(false);
    expect(verify(SECRET, "garbage", body, at)).toBe(false);
    expect(verify(SECRET, "t=abc,v1=" + "0".repeat(64), body, at)).toBe(false);
  });
});

describe("CRM sync — API request signing", () => {
  it("binds the signature to method, path + query and body", () => {
    const at = new Date("2026-09-24T10:00:00Z");
    const signed = apiSigningString("post", "/api/v1/cases/1/assign?x=1", '{"userId":"u"}');
    const h = sign(SECRET, signed, at);
    expect(verify(SECRET, h, apiSigningString("POST", "/api/v1/cases/1/assign?x=1", '{"userId":"u"}'), at)).toBe(true);
    expect(verify(SECRET, h, apiSigningString("PUT", "/api/v1/cases/1/assign?x=1", '{"userId":"u"}'), at)).toBe(false);
    expect(verify(SECRET, h, apiSigningString("POST", "/api/v1/cases/2/assign?x=1", '{"userId":"u"}'), at)).toBe(false);
    expect(verify(SECRET, h, apiSigningString("POST", "/api/v1/cases/1/assign", '{"userId":"u"}'), at)).toBe(false);
    expect(verify(SECRET, h, apiSigningString("POST", "/api/v1/cases/1/assign?x=1", '{"userId":"v"}'), at)).toBe(false);
  });
});

describe("CRM sync — which events go to the CRM", () => {
  const ev = (eventType: string, payload: Record<string, unknown> = {}) => ({ eventType, payload: { tenantId: "t", at: "x", ...payload } }) as Parameters<typeof crmEventFor>[0];

  it("Warm push and Hot both announce the lead; S0 → S1 stage change is not sent twice", () => {
    expect(crmEventFor(ev("case.pushed"))).toBe("lead.pushed");
    expect(crmEventFor(ev("case.temperature_set", { temperature: "HOT" }))).toBe("lead.pushed");
    expect(crmEventFor(ev("case.temperature_set", { temperature: "WARM" }))).toBeNull();
    expect(crmEventFor(ev("case.stage_changed", { from: "S0", to: "S1" }))).toBeNull();
  });

  it("later stage changes are sent; unrelated events are not", () => {
    expect(crmEventFor(ev("case.stage_changed", { from: "S1", to: "S2" }))).toBe("lead.stage_changed");
    expect(crmEventFor(ev("case.stage_changed", { from: "S2", to: "CLOSED" }))).toBe("lead.stage_changed");
    expect(crmEventFor(ev("case.created"))).toBeNull();
    expect(crmEventFor(ev("financing.decided"))).toBeNull();
  });
});

describe("CRM sync — inbound event schema", () => {
  const base = { eventId: "crm-1", occurredAt: "2026-09-24T10:00:00+05:30", ecofyCaseId: "0b6f0f5e-6c5e-4a8e-9a53-2f4f7f1d2c11", crmLeadId: "L-1", actorName: "Sales Head" };

  it("accepts each supported type", () => {
    for (const e of [
      { ...base, type: "lead.accepted" },
      { ...base, type: "lead.assigned", data: { assigneeName: "Priya" } },
      { ...base, type: "lead.activity", data: { type: "CALL", callOutcome: "CONNECTED", note: "ok" } },
      { ...base, type: "lead.returned", data: { reasonCode: "WANTS_LATER" } },
      { ...base, type: "lead.closed", data: { closureReason: "NOT_INTERESTED" } },
    ]) expect(CrmInboundEvent.safeParse(e).success).toBe(true);
  });

  it("rejects unknown types, missing ids and bad activity types", () => {
    expect(CrmInboundEvent.safeParse({ ...base, type: "lead.deleted" }).success).toBe(false);
    expect(CrmInboundEvent.safeParse({ ...base, type: "lead.accepted", ecofyCaseId: "not-a-uuid" }).success).toBe(false);
    expect(CrmInboundEvent.safeParse({ ...base, type: "lead.accepted", crmLeadId: "" }).success).toBe(false);
    expect(CrmInboundEvent.safeParse({ ...base, type: "lead.activity", data: { type: "SYSTEM" } }).success).toBe(false);
  });
});
