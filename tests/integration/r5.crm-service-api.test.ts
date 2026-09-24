import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ensureTestTenant, resetTestData, closeOwner, owner, type TestTenant } from "../helpers/testDb";
import { ApiClient, expectOk, idem } from "../helpers/api";
import { registerAllRoutes } from "../helpers/routes";
import { createLead, customer } from "../helpers/fixtures";

/**
 * The iTarang CRM calls the same REST API an iTarang user uses, signed instead of logged in
 * (docs/ITARANG_CRM_SYNC.md §5): same roles, RLS, gates, If-Match, Idempotency-Key and audit.
 */
const SECRET = "crm-test-secret-crm-test-secret-0123456789";

let t: TestTenant;
let eu: ApiClient;
let svc: ApiClient; // never logged in: no cookies

type Opts = { actAs?: string; actorName?: string; ifMatch?: number; idempotencyKey?: string; secret?: string; signPath?: string; signBody?: string };
async function service(method: string, path: string, body?: unknown, o: Opts = {}) {
  const { sign, apiSigningString } = await import("@/core/auth/hmac");
  const raw = body === undefined ? "" : JSON.stringify(body);
  const headers: Record<string, string> = { "x-itarang-signature": sign(o.secret ?? SECRET, apiSigningString(method, `/api/v1${o.signPath ?? path}`, o.signBody ?? raw)) };
  if (o.actAs) headers["x-itarang-act-as"] = o.actAs;
  if (o.actorName) headers["x-itarang-actor-name"] = o.actorName;
  return svc.call(method, path, { body, headers, ifMatch: o.ifMatch, idempotencyKey: o.idempotencyKey });
}

async function hotLead() {
  const c = await createLead(eu);
  return expectOk<{ id: string; version: number; stage: string }>(await eu.post(`/cases/${c.id}/temperature`, { temperature: "HOT" }, { ifMatch: c.version }));
}

beforeAll(async () => {
  process.env.ITARANG_CRM_SECRET = SECRET;
  process.env.ITARANG_CRM_ACTOR_EMAIL = "ia@test.local";
  const { resetConfigCache } = await import("@/core/config");
  resetConfigCache();
  registerAllRoutes();
  t = await ensureTestTenant();
  await resetTestData(t.tenantId);
  eu = await new ApiClient(t, "ECOFY_USER").login();
  svc = new ApiClient(t, "ITARANG_ADMIN");
});
afterAll(async () => { await closeOwner(); });

describe("R5 — iTarang CRM as an iTarang user over the API", () => {
  it("reads the queue and assigns a lead exactly like the iTarang Admin; audit names the CRM person", async () => {
    const c = await hotLead();
    const q = expectOk<Array<{ id: string }>>(await service("GET", "/queue"));
    expect(q.map((x) => x.id)).toContain(c.id);
    const s2 = expectOk<{ stage: string; assignedUserId: string }>(await service("POST", `/cases/${c.id}/assign`, { userId: t.users.ITARANG_CALLER.id }, { ifMatch: c.version, actorName: "Priya (Sales Head)" }));
    expect(s2).toMatchObject({ stage: "S2", assignedUserId: t.users.ITARANG_CALLER.id });
    const a = await owner()`select actor_id, user_agent from audit_log where tenant_id = ${t.tenantId} and case_id = ${c.id} and action = 'case.assign'`;
    expect(a[0].actor_id).toBe(t.users.ITARANG_ADMIN.id);
    expect(a[0].user_agent).toBe("itarang-crm (Priya (Sales Head))");
    // If-Match still applies
    const stale = await service("POST", `/cases/${c.id}/assign`, { userId: t.users.ITARANG_ADMIN.id, reason: "x" }, { ifMatch: c.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code).toBe("VERSION_CONFLICT");
  });

  it("creates an iTarang-sourced lead with Idempotency-Key (replay returns the same case)", async () => {
    const body = { customer: customer(), segment: "RESI", productInterest: "SOLAR_STORAGE" };
    const key = idem();
    const a = expectOk<{ id: string; stage: string; owner: string }>(await service("POST", "/cases", body, { idempotencyKey: key }), 201);
    expect(a).toMatchObject({ stage: "S1", owner: "ITARANG" });
    const b = expectOk<{ id: string }>(await service("POST", "/cases", body, { idempotencyKey: key }), 201);
    expect(b.id).toBe(a.id);
  });

  it("act-as a Caller: the caller's role rules apply (activities yes, the admin queue no)", async () => {
    const c = await hotLead();
    const s2 = expectOk<{ version: number }>(await service("POST", `/cases/${c.id}/assign`, { userId: t.users.ITARANG_CALLER.id }, { ifMatch: c.version }));
    expect(s2.version).toBeGreaterThan(c.version);
    const act = await service("POST", `/cases/${c.id}/activities`, { type: "CALL", callOutcome: "CONNECTED", note: "ok" }, { actAs: "ic@test.local" });
    expect(act.status).toBe(201);
    expect((await service("GET", "/queue", undefined, { actAs: "ic@test.local" })).status).toBe(403);
  });

  it("rejects: Ecofy users can't be acted as, bad/moved signatures, /auth routes, no credentials", async () => {
    const c = await hotLead();
    expect((await service("GET", "/queue", undefined, { actAs: "eu1@test.local" })).status).toBe(403);
    expect((await service("GET", "/queue", undefined, { actAs: "nobody@test.local" })).status).toBe(401);
    expect((await service("GET", "/queue", undefined, { secret: "not-the-secret-not-the-secret-not-the-sec" })).status).toBe(401);
    // a signature for one request is not valid for another path or body
    expect((await service("GET", "/queue", undefined, { signPath: "/cases" })).status).toBe(401);
    expect((await service("POST", `/cases/${c.id}/activities`, { type: "REMARK", note: "real" }, { signBody: JSON.stringify({ type: "REMARK", note: "signed" }) })).status).toBe(401);
    expect((await service("POST", "/auth/logout")).status).toBe(403);
    expect((await svc.get("/queue")).status).toBe(401);
  });
});
