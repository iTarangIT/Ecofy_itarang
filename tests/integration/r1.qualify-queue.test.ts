import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ensureTestTenant, resetTestData, closeOwner, type TestTenant } from "../helpers/testDb";
import { ApiClient, expectOk, idem } from "../helpers/api";
import { registerAllRoutes } from "../helpers/routes";
import { createLead, customer, leadAtS2 } from "../helpers/fixtures";

let t: TestTenant;
let ea: ApiClient, eu: ApiClient, eu2: ApiClient, ia: ApiClient, ic: ApiClient;

beforeAll(async () => {
  registerAllRoutes();
  t = await ensureTestTenant();
  await resetTestData(t.tenantId);
  [ea, eu, eu2, ia, ic] = await Promise.all([
    new ApiClient(t, "ECOFY_ADMIN").login(), new ApiClient(t, "ECOFY_USER").login(), new ApiClient(t, "ECOFY_USER_2").login(),
    new ApiClient(t, "ITARANG_ADMIN").login(), new ApiClient(t, "ITARANG_CALLER").login(),
  ]);
});
afterAll(async () => { await closeOwner(); });

describe("R1 — access, qualification, queue, follow-up", () => {
  it("GET /me returns role and permissions; unauthenticated is 401", async () => {
    const me = expectOk<{ role: string; permissions: string[] }>(await ic.get("/me"));
    expect(me.role).toBe("ITARANG_CALLER");
    expect(me.permissions).toContain("otp.send");
    const anon = new ApiClient(t, "ITARANG_CALLER");
    const r = await anon.get("/cases");
    expect(r.status).toBe(401);
    expect(r.body.error?.code).toBe("UNAUTHENTICATED");
  });

  it("UAT-04: Hot goes straight to the queue; EU still sees it read-only", async () => {
    const c = await createLead(eu);
    expect(c.stage).toBe("S0");
    const hot = expectOk<{ stage: string; temperature: string; queueEnteredAt: string; version: number }>(await eu.post(`/cases/${c.id}/temperature`, { temperature: "HOT" }, { ifMatch: c.version }));
    expect(hot.stage).toBe("S1");
    expect(hot.temperature).toBe("HOT");
    expect(hot.queueEnteredAt).toBeTruthy();
    const q = expectOk<Array<{ id: string }>>(await ia.get("/queue"));
    expect(q.map((x) => x.id)).toContain(c.id);
    // EU (qualifier) can still read it, but cannot change the stage
    expectOk(await eu.get(`/cases/${c.id}`));
    const again = await eu.post(`/cases/${c.id}/temperature`, { temperature: "WARM" }, { ifMatch: hot.version });
    expect(again.status).toBe(409);
  });

  it("UAT-05: Warm waits for a push; both Ecofy roles can push; EU cannot see the other EU's lead", async () => {
    const a = await createLead(eu);
    const b = await createLead(eu2);
    const wa = expectOk<{ stage: string; version: number }>(await eu.post(`/cases/${a.id}/temperature`, { temperature: "WARM" }, { ifMatch: a.version }));
    expect(wa.stage).toBe("S0");
    const wb = expectOk<{ stage: string; version: number }>(await eu2.post(`/cases/${b.id}/temperature`, { temperature: "WARM" }, { ifMatch: b.version }));
    // EU cannot see or push the other EU's lead → 404 (RLS)
    expect((await eu.get(`/cases/${b.id}`)).status).toBe(404);
    expect((await eu.post(`/cases/${b.id}/push`, {}, { ifMatch: wb.version })).status).toBe(404);
    const pa = expectOk<{ stage: string }>(await eu.post(`/cases/${a.id}/push`, { note: "wants a call next week" }, { ifMatch: wa.version }));
    const pb = expectOk<{ stage: string }>(await ea.post(`/cases/${b.id}/push`, {}, { ifMatch: wb.version }));
    expect(pa.stage).toBe("S1");
    expect(pb.stage).toBe("S1");
    // push on a Cold lead is a gate failure
    const c = await createLead(eu);
    const r = await eu.post(`/cases/${c.id}/push`, {}, { ifMatch: c.version });
    expect(r.status).toBe(409);
    expect(r.body.error?.code).toBe("GATE_NOT_MET");
    expect(r.body.error?.gate).toBe("temperature_warm");
  });

  it("bulk push (CONFLICTS #26): Warm S0 leads are pushed, the rest are reported with the gate", async () => {
    const warm = await createLead(eu);
    const cold = await createLead(eu);
    const other = await createLead(eu2);
    const w = expectOk<{ version: number }>(await eu.post(`/cases/${warm.id}/temperature`, { temperature: "WARM" }, { ifMatch: warm.version }));
    expect(w.version).toBeGreaterThan(warm.version);
    const r = expectOk<{ pushed: number; skipped: Array<{ caseId: string; code: string; gate: string | null }> }>(
      await eu.post("/cases/bulk-push", { caseIds: [warm.id, cold.id, other.id], note: "bulk push" }),
    );
    expect(r.pushed).toBe(1);
    expect(r.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ caseId: cold.id, code: "GATE_NOT_MET", gate: "temperature_warm" }),
      expect.objectContaining({ caseId: other.id, code: "NOT_FOUND" }), // the other EU's lead is invisible (RLS)
    ]));
    expect(expectOk<{ stage: string }>(await eu.get(`/cases/${warm.id}`)).stage).toBe("S1");
    expect(expectOk<{ stage: string }>(await eu.get(`/cases/${cold.id}`)).stage).toBe("S0");
    // a second run skips the already-pushed lead on the stage gate
    const again = expectOk<{ pushed: number; skipped: Array<{ gate: string | null }> }>(await eu.post("/cases/bulk-push", { caseIds: [warm.id] }));
    expect(again.pushed).toBe(0);
    expect(again.skipped[0].gate).toBe("stage");
    // callers cannot bulk-push
    expect((await ia.post("/cases/bulk-push", { caseIds: [cold.id] })).status).toBe(403);
  });

  it("queue order: Hot first, then Warm by push time", async () => {
    await resetTestData(t.tenantId);
    const w = await createLead(eu);
    const wv = expectOk<{ version: number }>(await eu.post(`/cases/${w.id}/temperature`, { temperature: "WARM" }, { ifMatch: w.version }));
    expectOk(await eu.post(`/cases/${w.id}/push`, {}, { ifMatch: wv.version }));
    const h = await createLead(eu);
    expectOk(await eu.post(`/cases/${h.id}/temperature`, { temperature: "HOT" }, { ifMatch: h.version }));
    const q = expectOk<Array<{ id: string; temperature: string; ageing: { inStageWorkingHours: number } }>>(await ia.get("/queue"));
    expect(q[0].id).toBe(h.id);
    expect(q[1].id).toBe(w.id);
    expect(q[0].ageing.inStageWorkingHours).toBeGreaterThanOrEqual(0);
  });

  it("UAT-06: return to Ecofy goes back to S0 and to the qualifier, who is notified", async () => {
    const c = await createLead(eu);
    const hot = expectOk<{ version: number }>(await eu.post(`/cases/${c.id}/temperature`, { temperature: "HOT" }, { ifMatch: c.version }));
    const bad = await ia.post(`/cases/${c.id}/return`, { reasonCode: "NOPE" }, { ifMatch: hot.version });
    expect(bad.status).toBe(422);
    const ret = expectOk<{ stage: string; assignedUserId: string; temperature: string | null }>(await ia.post(`/cases/${c.id}/return`, { reasonCode: "WRONG_NUMBER", note: "number unreachable" }, { ifMatch: hot.version }));
    expect(ret.stage).toBe("S0");
    expect(ret.assignedUserId).toBe(t.users.ECOFY_USER.id);
    const tl = expectOk<Array<{ kind: string; title: string }>>(await eu.get(`/cases/${c.id}/timeline`));
    expect(tl.some((i) => i.kind === "stage" && i.title.includes("S1 → S0"))).toBe(true);
    // notification is created by the worker relay; verify the outbox row exists
    const { owner } = await import("../helpers/testDb");
    const rows = await owner()`select payload from outbox_events where tenant_id = ${t.tenantId} and event_type = 'case.returned' and aggregate_id = ${c.id}`;
    expect(rows.length).toBe(1);
  });

  it("assign from queue moves S1 → S2; reassign needs a reason; If-Match mismatch is 409", async () => {
    const c = await leadAtS2(eu, ia, t.users.ITARANG_CALLER.id);
    expect(c.stage).toBe("S2");
    const stale = await ia.post(`/cases/${c.id}/assign`, { userId: t.users.ITARANG_ADMIN.id }, { ifMatch: c.version - 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("VERSION_CONFLICT");
    const noReason = await ia.post(`/cases/${c.id}/assign`, { userId: t.users.ITARANG_ADMIN.id }, { ifMatch: c.version });
    expect(noReason.status).toBe(422);
    const re = expectOk<{ stage: string; assignedUserId: string }>(await ia.post(`/cases/${c.id}/assign`, { userId: t.users.ITARANG_ADMIN.id, reason: "caller on leave" }, { ifMatch: c.version }));
    expect(re.stage).toBe("S2");
    expect(re.assignedUserId).toBe(t.users.ITARANG_ADMIN.id);
    // the caller no longer sees it
    expect((await ic.get(`/cases/${c.id}`)).status).toBe(404);
  });

  it("UAT-08: meeting gate to S3 — GATE_NOT_MET until a completed meeting/EPC visit", async () => {
    const c = await leadAtS2(eu, ia, t.users.ITARANG_CALLER.id);
    const first = await ic.post(`/cases/${c.id}/advance`, undefined, { ifMatch: c.version });
    expect(first.status).toBe(409);
    expect(first.body.error?.gate).toBe("meeting_before_assessment");
    const appt = expectOk<{ id: string }>(await ic.post(`/cases/${c.id}/appointments`, { meetingType: "EPC_VISIT", scheduledAt: new Date().toISOString(), bookingRemarks: "survey", epcPartnerId: t.epcPartnerId }), 201);
    // UAT-09: complete without remarks / no-show without reason are blocked
    expect((await ic.patch(`/appointments/${appt.id}`, { action: "COMPLETE", actualAt: new Date().toISOString() })).status).toBe(422);
    expect((await ic.patch(`/appointments/${appt.id}`, { action: "NO_SHOW" })).status).toBe(422);
    // reschedule creates a linked appointment
    const re = expectOk<{ id: string; rescheduledFrom: string }>(await ic.patch(`/appointments/${appt.id}`, { action: "RESCHEDULE", scheduledAt: new Date(Date.now() + 3600_000).toISOString() }));
    expect(re.rescheduledFrom).toBe(appt.id);
    expectOk(await ic.patch(`/appointments/${re.id}`, { action: "COMPLETE", actualAt: new Date().toISOString(), meetingRemarks: "Customer wants 5 kWh" }));
    const cur = expectOk<{ version: number }>(await ic.get(`/cases/${c.id}`));
    const s3 = expectOk<{ stage: string }>(await ic.post(`/cases/${c.id}/advance`, undefined, { ifMatch: cur.version }));
    expect(s3.stage).toBe("S3");
  });

  it("activities: call needs outcome; first caller call stamps first_call_at; Ecofy comments only after handoff", async () => {
    const c = await leadAtS2(eu, ia, t.users.ITARANG_CALLER.id);
    expect((await ic.post(`/cases/${c.id}/activities`, { type: "CALL" })).status).toBe(422);
    expectOk(await ic.post(`/cases/${c.id}/activities`, { type: "CALL", callOutcome: "CONNECTED", note: "spoke", nextFollowUpAt: new Date(Date.now() + 86400_000).toISOString() }), 201);
    const after = expectOk<{ firstCallAt: string; hotToFirstCallHours: number }>(await ic.get(`/cases/${c.id}`));
    expect(after.firstCallAt).toBeTruthy();
    expect(after.hotToFirstCallHours).toBeGreaterThanOrEqual(0);
    expect((await eu.post(`/cases/${c.id}/activities`, { type: "CALL", callOutcome: "BUSY" })).status).toBe(403);
    expectOk(await eu.post(`/cases/${c.id}/activities`, { type: "COMMENT", note: "customer prefers evenings" }), 201);
  });

  it("close before acceptance needs a listed reason; Not interested closes at S0; IA can reopen without a File", async () => {
    const c = await createLead(eu);
    const ni = expectOk<{ stage: string; closureReason: string; version: number }>(await eu.post(`/cases/${c.id}/temperature`, { temperature: "NOT_INTERESTED", closureReason: "NOT_INTERESTED" }, { ifMatch: c.version }));
    expect(ni.stage).toBe("CLOSED");
    const re = expectOk<{ stage: string; reopenCount: number }>(await ia.post(`/cases/${c.id}/reopen`, { reason: "customer called back" }, { ifMatch: ni.version }));
    expect(re.stage).toBe("S0");
    expect(re.reopenCount).toBe(1);
  });

  it("UAT-33: seats — invite blocked at cap, allowed after IA raises it", async () => {
    const r1 = await ea.post("/users", { fullName: "Third User", email: "eu3@test.local", role: "ECOFY_USER" });
    expect(r1.status).toBe(409);
    expect(r1.body.error?.code).toBe("SEAT_LIMIT");
    expectOk(await ia.patch("/seats/ECOFY_USER", { seatLimit: 3, reason: "growth" }));
    const r2 = await ea.post("/users", { fullName: "Third User", email: "eu3@test.local", role: "ECOFY_USER" });
    expect(r2.status).toBe(201);
    // EA cannot invite an iTarang role
    expect((await ea.post("/users", { fullName: "Xavier", email: "x@test.local", role: "ITARANG_CALLER" })).status).toBe(403);
    // deactivate releases the seat
    expectOk(await ea.patch(`/users/${r2.body.data.id}`, { status: "DEACTIVATED", reason: "left" }));
    const seats = expectOk<Array<{ role: string; seatsUsed: number; seatLimit: number }>>(await ia.get("/seats"));
    expect(seats.find((s) => s.role === "ECOFY_USER")).toMatchObject({ seatsUsed: 2, seatLimit: 3 });
    expectOk(await ia.patch("/seats/ECOFY_USER", { seatLimit: 2, reason: "back to contract" }));
  });

  it("UAT-30: KYC-like document types are rejected by the database; look-alikes are allowed", async () => {
    expect((await ia.post("/lists/document_type/items", { code: "PAN_CARD", label: "PAN card" })).status).toBe(422);
    expect((await ia.post("/lists/document_type/items", { code: "BANK_STMT", label: "Bank statement" })).status).toBe(422);
    expect((await ia.post("/lists/document_type/items", { code: "PANEL_PHOTO", label: "Solar panel photo" })).status).toBe(201);
  });

  it("settings: type-checked PATCH, audited, served back", async () => {
    expect((await ia.patch("/settings/gates.meeting_before_assessment", { value: "yes" })).status).toBe(422);
    expect((await ia.patch("/settings/gates.s4_order", { value: "RANDOM" })).status).toBe(422);
    expectOk(await ia.patch("/settings/quotes.default_validity_days", { value: 45, reason: "EPC asked" }));
    const s = expectOk<Record<string, unknown>>(await ea.get("/settings"));
    expect(s["quotes.default_validity_days"]).toBe(45);
    expect((await ea.patch("/settings/quotes.default_validity_days", { value: 30 })).status).toBe(403);
    const a = expectOk<Array<{ action: string }>>(await ia.get("/audit?action=setting"));
    expect(a.some((x) => x.action === "setting.change")).toBe(true);
  });

  it("idempotency: same key replays; same key with a different body is 422", async () => {
    const key = idem();
    const body = { customer: customer(), segment: "RESI" };
    const a = await eu.post("/cases", body, { idempotencyKey: key });
    expect(a.status).toBe(201);
    const b = await eu.post("/cases", body, { idempotencyKey: key });
    expect(b.status).toBe(201);
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(b.headers.get("Idempotent-Replayed")).toBe("true");
    const c = await eu.post("/cases", { ...body, segment: "ESS" }, { idempotencyKey: key });
    expect(c.status).toBe(422);
    expect(c.body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("UAT-34: scope — caller only sees own cases; EA sees Ecofy-sourced; IA sees all; lists mask mobiles", async () => {
    await resetTestData(t.tenantId);
    const mine = await leadAtS2(eu, ia, t.users.ITARANG_CALLER.id);
    const other = await createLead(eu2);
    const iaLead = expectOk<{ id: string; stage: string }>(await ia.post("/cases", { customer: customer(), segment: "ESS" }, { idempotencyKey: idem() }), 201);
    expect(iaLead.stage).toBe("S1");
    const callerList = expectOk<Array<{ id: string; customer: { mobile: string } }>>(await ic.get("/cases"));
    expect(callerList.map((c) => c.id)).toEqual([mine.id]);
    expect(callerList[0].customer.mobile).toMatch(/^\+91\*{6}\d{4}$/);
    expect((await ic.get(`/cases/${other.id}`)).status).toBe(404);
    const eaList = expectOk<Array<{ id: string }>>(await ea.get("/cases"));
    expect(eaList.map((c) => c.id).sort()).toEqual([mine.id, other.id, iaLead.id].sort()); // iTarang-sourced lead: Ecofy is its default financier → visible
    const iaList = expectOk<Array<{ id: string }>>(await ia.get("/cases"));
    expect(iaList.length).toBe(3);
    expect((await ic.get("/audit")).status).toBe(403);
  });
});
