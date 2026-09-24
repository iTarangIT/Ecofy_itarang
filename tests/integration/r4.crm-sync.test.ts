import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { ensureTestTenant, resetTestData, closeOwner, owner, TEST_HOST, type TestTenant } from "../helpers/testDb";
import { ApiClient, expectOk } from "../helpers/api";
import { registerAllRoutes } from "../helpers/routes";
import { createLead } from "../helpers/fixtures";
import { relay } from "../helpers/r2";

/** iTarang CRM sync (docs/ITARANG_CRM_SYNC.md): outbound deliveries + signed inbound events. */
const SECRET = "crm-test-secret-crm-test-secret-0123456789";
const CRM_URL = "http://crm.test/api/integrations/ecofy/events";

let t: TestTenant;
let eu: ApiClient, ia: ApiClient;
let seq = 0;

type Sent = { url: string; headers: Record<string, string>; body: any };
function fakeCrm(reply: (b: any) => { status: number; json?: unknown }) {
  const sent: Sent[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    sent.push({ url, headers: init.headers as Record<string, string>, body });
    const r = reply(body);
    return new Response(r.json === undefined ? "" : JSON.stringify(r.json), { status: r.status });
  }) as unknown as typeof fetch;
  return { sent, impl };
}

async function deliver(fetchImpl: typeof fetch) {
  const { deliverDue } = await import("@/modules/m18-crm-sync/outbound");
  return deliverDue(t.tenantId, { fetchImpl });
}

async function deliveries(caseId: string) {
  return owner()<{ event_type: string; status: string; attempts: number; body: any; next_attempt_at: Date }[]>`
    select event_type, status, attempts, body, next_attempt_at from integration_deliveries where tenant_id = ${t.tenantId} and case_id = ${caseId} order by id`;
}

async function inbound(event: Record<string, unknown>, opts: { secret?: string; signature?: string } = {}) {
  const { sign } = await import("@/core/auth/hmac");
  const { POST } = await import("@/app/api/v1/integrations/itarang/events/route");
  const raw = JSON.stringify(event);
  const req = new NextRequest(`http://${TEST_HOST}/api/v1/integrations/itarang/events`, {
    method: "POST",
    headers: { host: TEST_HOST, "content-type": "application/json", "x-itarang-signature": opts.signature ?? sign(opts.secret ?? SECRET, raw) },
    body: raw,
  });
  const res = await POST(req);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {}, duplicate: res.headers.get("x-itarang-duplicate") === "true" };
}

function evt(caseId: string, type: string, data: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { eventId: `crm-evt-${Date.now()}-${++seq}`, type, occurredAt: new Date().toISOString(), ecofyCaseId: caseId, crmLeadId: `CRM-${caseId.slice(0, 8)}`, actorName: "Sales Head", data, ...extra };
}

async function pushedLead() {
  const c = await createLead(eu);
  const warm = expectOk<{ version: number }>(await eu.post(`/cases/${c.id}/temperature`, { temperature: "WARM" }, { ifMatch: c.version }));
  expectOk(await eu.post(`/cases/${c.id}/push`, { note: "Interested, call after 5 pm" }, { ifMatch: warm.version }));
  await relay(t.tenantId);
  return c;
}

beforeAll(async () => {
  process.env.ITARANG_CRM_URL = CRM_URL;
  process.env.ITARANG_CRM_SECRET = SECRET;
  process.env.ITARANG_CRM_ACTOR_EMAIL = "ia@test.local";
  const { resetConfigCache } = await import("@/core/config");
  resetConfigCache();
  registerAllRoutes();
  t = await ensureTestTenant();
  await resetTestData(t.tenantId);
  [eu, ia] = await Promise.all([new ApiClient(t, "ECOFY_USER").login(), new ApiClient(t, "ITARANG_ADMIN").login()]);
});
afterAll(async () => { await closeOwner(); });

describe("R4 — iTarang CRM sync", () => {
  it("Warm push → one signed lead.pushed delivery, no money keys; CRM id is linked from the reply", async () => {
    const c = await pushedLead();
    const rows = await deliveries(c.id);
    expect(rows.map((r) => r.event_type)).toEqual(["lead.pushed"]);
    const body = rows[0].body;
    expect(body.lead).toMatchObject({ ecofyCaseId: c.id, caseNo: c.caseNo, stage: "S1", temperature: "WARM" });
    expect(body.lead.customer.mobile).toMatch(/^\+91/);
    expect(JSON.stringify(body)).not.toMatch(/sanctionedInr|amountInr|limitInr|disbursedInr|emi/i);
    await relay(t.tenantId); // re-relay: idempotent per outbox event
    expect((await deliveries(c.id)).length).toBe(1);

    const crm = fakeCrm(() => ({ status: 201, json: { crmLeadId: "CRM-77" } }));
    expect(await deliver(crm.impl)).toMatchObject({ sent: 1 });
    expect(crm.sent[0].url).toBe(CRM_URL);
    const { verify } = await import("@/core/auth/hmac");
    expect(verify(SECRET, crm.sent[0].headers["x-itarang-signature"], JSON.stringify(crm.sent[0].body))).toBe(true);
    expect(verify("wrong-secret-wrong-secret-wrong-secret-00", crm.sent[0].headers["x-itarang-signature"], JSON.stringify(crm.sent[0].body))).toBe(false);
    expect((await deliveries(c.id))[0].status).toBe("SENT");
    const link = await owner()`select external_id from integration_links where tenant_id = ${t.tenantId} and case_id = ${c.id}`;
    expect(link[0].external_id).toBe("CRM-77");
  });

  it("Hot lead is announced as lead.pushed too; leads that never left S0 are not sent", async () => {
    const hot = await createLead(eu);
    expectOk(await eu.post(`/cases/${hot.id}/temperature`, { temperature: "HOT" }, { ifMatch: hot.version }));
    const cold = await createLead(eu);
    expectOk(await eu.post(`/cases/${cold.id}/temperature`, { temperature: "COLD" }, { ifMatch: cold.version }));
    await relay(t.tenantId);
    expect((await deliveries(hot.id)).map((r) => r.event_type)).toEqual(["lead.pushed"]);
    expect((await deliveries(hot.id))[0].body.lead.temperature).toBe("HOT");
    expect(await deliveries(cold.id)).toEqual([]);
  });

  it("CRM down → retried with back-off, and a newer event of the same lead waits behind it", async () => {
    await deliver(fakeCrm(() => ({ status: 200 })).impl); // flush earlier tests
    const c = await pushedLead();
    const down = fakeCrm(() => ({ status: 503, json: { error: "maintenance" } }));
    expect(await deliver(down.impl)).toMatchObject({ retried: 1 });
    let rows = await deliveries(c.id);
    expect(rows[0]).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(new Date(rows[0].next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    // a stage change while the first is still pending
    expect((await inbound(evt(c.id, "lead.returned", { reasonCode: "WANTS_LATER", note: "Busy this week" }))).status).toBe(200);
    await relay(t.tenantId);
    rows = await deliveries(c.id);
    expect(rows.map((r) => r.event_type)).toEqual(["lead.pushed", "lead.stage_changed"]);
    await owner()`update integration_deliveries set next_attempt_at = now() - interval '1 second' where tenant_id = ${t.tenantId} and case_id = ${c.id}`;
    const up = fakeCrm(() => ({ status: 200 }));
    await deliver(up.impl);
    expect(up.sent.filter((s) => s.body.lead.ecofyCaseId === c.id).map((s) => s.body.type)).toEqual(["lead.pushed", "lead.stage_changed"]);
    expect(up.sent.find((s) => s.body.type === "lead.stage_changed")!.body.change).toMatchObject({ from: "S1", to: "S0", reason: "WANTS_LATER" });
  });

  it("Inbound lead.assigned moves S1 → S2 through the state engine; a retried event is applied once", async () => {
    const c = await pushedLead();
    const e = evt(c.id, "lead.assigned", { assigneeName: "Priya (CRM)" });
    const r1 = await inbound(e);
    expect(r1.status).toBe(200);
    expect(r1.body.data.case).toMatchObject({ ecofyCaseId: c.id, stage: "S2" });
    const r2 = await inbound(e);
    expect(r2.status).toBe(200);
    expect(r2.duplicate).toBe(true);
    expect(r2.body).toEqual(r1.body);
    const cs = expectOk<{ stage: string; assignedUserId: string }>(await ia.get(`/cases/${c.id}`));
    expect(cs).toMatchObject({ stage: "S2", assignedUserId: t.users.ITARANG_ADMIN.id });
    const audit = await owner()`select actor_id, reason from audit_log where tenant_id = ${t.tenantId} and case_id = ${c.id} and action = 'case.assign'`;
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_id).toBe(t.users.ITARANG_ADMIN.id);
    expect(audit[0].reason).toContain("Priya (CRM)");
    await relay(t.tenantId);
    expect((await deliveries(c.id)).map((r) => r.event_type)).toContain("lead.stage_changed");
  });

  it("Inbound activity and close; Ecofy sees them on the case", async () => {
    const c = await pushedLead();
    expect((await inbound(evt(c.id, "lead.activity", { type: "CALL", callOutcome: "CONNECTED", note: "Wants a 5 kW system" }))).status).toBe(200);
    const acts = expectOk<Array<{ type: string; note: string; callOutcome: string }>>(await eu.get(`/cases/${c.id}/activities`));
    expect(acts.find((a) => a.type === "CALL")).toMatchObject({ callOutcome: "CONNECTED", note: "[iTarang CRM · Sales Head] Wants a 5 kW system" });
    const closed = await inbound(evt(c.id, "lead.closed", { closureReason: "NOT_INTERESTED", note: "Chose another vendor" }));
    expect(closed.body.data.case.stage).toBe("CLOSED");
  });

  it("Admin › Integration: status (no secret), test ping, retry of a failed delivery; callers are refused", async () => {
    const st = expectOk<{ outboundEnabled: boolean; inboundEnabled: boolean; secretConfigured: boolean; crmUrl: string; actor: { email: string; active: boolean }; deliveries: { sent: number }; recentDeliveries: Array<{ id: number; status: string }> }>(await ia.get("/integrations/itarang/status"));
    expect(st).toMatchObject({ outboundEnabled: true, inboundEnabled: true, secretConfigured: true, crmUrl: CRM_URL, actor: { email: "ia@test.local", active: true } });
    expect(JSON.stringify(st)).not.toContain(SECRET);
    const ea = await new ApiClient(t, "ECOFY_ADMIN").login();
    expect((await ea.get("/integrations/itarang/status")).status).toBe(200);
    expect((await eu.get("/integrations/itarang/status")).status).toBe(403);

    // crm.test does not resolve: the ping reports the failure instead of throwing, and is audited
    const ping = expectOk<{ ok: boolean; status: number | null; request: { type: string } }>(await ia.post("/integrations/itarang/test"));
    expect(ping).toMatchObject({ ok: false, status: null, request: { type: "ping" } });
    expect((await owner()`select 1 from audit_log where tenant_id = ${t.tenantId} and action = 'integration.test'`).length).toBeGreaterThan(0);

    const c = await pushedLead();
    await owner()`update integration_deliveries set status = 'DEAD', attempts = 12 where tenant_id = ${t.tenantId} and case_id = ${c.id}`;
    const id = (await owner()<{ id: number }[]>`select id from integration_deliveries where tenant_id = ${t.tenantId} and case_id = ${c.id}`)[0].id;
    expectOk(await ia.post(`/integrations/itarang/deliveries/${id}/retry`));
    expect((await deliveries(c.id))[0]).toMatchObject({ status: "PENDING", attempts: 0 });
    await deliver(fakeCrm(() => ({ status: 200 })).impl);
    expect((await ia.post(`/integrations/itarang/deliveries/${id}/retry`)).status).toBe(409); // already SENT
  });

  it("Rejects: bad signature 401, bad body 422, case never sent 409 (recorded), other CRM lead id 422, gate failures carry the gate", async () => {
    const c = await pushedLead();
    expect((await inbound(evt(c.id, "lead.accepted"), { secret: "not-the-secret-not-the-secret-not-the-sec" })).status).toBe(401);
    expect((await inbound(evt(c.id, "lead.accepted"), { signature: "t=1,v1=00" })).status).toBe(401);
    expect((await inbound(evt(c.id, "lead.nope"))).status).toBe(422);

    const s0 = await createLead(eu);
    const never = evt(s0.id, "lead.activity", { type: "REMARK", note: "x" });
    const r = await inbound(never);
    expect(r.status).toBe(409);
    expect(r.body.error.gate).toBe("crm_lead");
    expect((await inbound(never)).duplicate).toBe(true);

    expect((await inbound(evt(c.id, "lead.accepted"))).status).toBe(200);
    expect((await inbound(evt(c.id, "lead.accepted", {}, { crmLeadId: "SOMETHING-ELSE" }))).status).toBe(422);

    const s2 = await inbound(evt(c.id, "lead.assigned", { assigneeName: "A" }));
    expect(s2.body.data.case.stage).toBe("S2");
    const cur = expectOk<{ version: number }>(await ia.get(`/cases/${c.id}`));
    expectOk(await ia.post(`/cases/${c.id}/close`, { closureReason: "NOT_INTERESTED" }, { ifMatch: cur.version }));
    const late = await inbound(evt(c.id, "lead.returned", { reasonCode: "WANTS_LATER" }));
    expect(late.status).toBe(409);
    expect(late.body.error.gate).toBe("stage");
  });
});
