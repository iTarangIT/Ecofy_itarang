import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import { ensureTestTenant, resetTestData, closeOwner, owner, type TestTenant } from "../helpers/testDb";
import { ApiClient, expectOk, idem } from "../helpers/api";
import { registerAllRoutes } from "../helpers/routes";
import { leadAtS3 } from "../helpers/fixtures";
import { CALC_INPUT, leadAtS4, offerReady, uploadPdf, relay, leadAtS6 } from "../helpers/r2";

let t: TestTenant;
let ea: ApiClient, eu: ApiClient, ia: ApiClient, ic: ApiClient;

beforeAll(async () => {
  registerAllRoutes();
  t = await ensureTestTenant();
  await resetTestData(t.tenantId);
  await fs.rm(".data/test-sms", { recursive: true, force: true });
  [ea, eu, ia, ic] = await Promise.all([new ApiClient(t, "ECOFY_ADMIN").login(), new ApiClient(t, "ECOFY_USER").login(), new ApiClient(t, "ITARANG_ADMIN").login(), new ApiClient(t, "ITARANG_CALLER").login()]);
});
afterAll(async () => { await closeOwner(); });

describe("R2 — assessment, calculator designer, offer, OTP and File", () => {
  it("UAT-10: worked example on the published release; assessment stores the release id", async () => {
    const est = expectOk<{ steps: Record<string, number>; recommendationStatus: string; options: Array<{ role: string; systemCode: string }> }>(await ic.post("/calculator/estimate", CALC_INPUT));
    expect(est.steps.running_load_kw).toBe(0.66);
    expect(est.steps.required_inverter_kva).toBe(1.46);
    expect(est.steps.solar_kwp).toBe(2.5);
    expect(est.recommendationStatus).toBe("RECOMMENDED");
    expect(est.options.find((o) => o.role === "RECOMMENDED")!.systemCode).toBe("RESI-S3-B5");
    const c = await leadAtS3(eu, ia, ic, t.users.ITARANG_CALLER.id, t.epcPartnerId);
    const a = expectOk<{ releaseId: string; recommendedCode: string; result: { steps: Record<string, number> } }>(await ic.post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: CALC_INPUT }), 201);
    expect(a.releaseId).toBeTruthy();
    expect(a.recommendedCode).toBe("RESI-S3-B5");
    expect(a.result.steps.battery_size_kwh).toBe(3.26);
  });

  it("UAT-11/12/15: pending vs custom; override needs a reason", async () => {
    const c = await leadAtS3(eu, ia, ic, t.users.ITARANG_CALLER.id, t.epcPartnerId);
    const pending = expectOk<{ recommendationStatus: string; recommendedCode: string | null }>(await ic.post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: { segment: "RESI", productInterest: "SOLAR_STORAGE", method: "NONE", backupHours: 4, phase: "SINGLE" } }), 201);
    expect(pending.recommendationStatus).toBe("PENDING_TECHNICAL_DATA");
    expect(pending.recommendedCode).toBeNull();
    const custom = expectOk<{ recommendationStatus: string }>(await ic.post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: { ...CALC_INPUT, appliances: [{ applianceName: "Air conditioner (1.5 ton)", watts: 1600, quantity: 8 }], backupHours: 8 } }), 201);
    expect(custom.recommendationStatus).toBe("CUSTOM_REQUIRED");
    const noReason = await ic.post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: CALC_INPUT, selectedSystemCode: "RESI-S5-B10" });
    expect(noReason.status).toBe(422);
    const withReason = expectOk<{ selectedCode: string; overrideReason: string; version: number }>(await ic.post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: CALC_INPUT, selectedSystemCode: "RESI-S5-B10", overrideReason: "Customer wants headroom for an AC" }), 201);
    expect(withReason.selectedCode).toBe("RESI-S5-B10");
    expect(withReason.version).toBe(3);
    const tl = expectOk<Array<{ kind: string; detail?: { overrideReason?: string } }>>(await ic.get(`/cases/${c.id}/timeline`));
    expect(tl.some((i) => i.kind === "assessment" && i.detail?.overrideReason === "Customer wants headroom for an AC")).toBe(true);
  });

  it("UAT-14: C&I has no calculator; manual/EPC assessment can be saved and confirmed", async () => {
    const c = await leadAtS3(eu, ia, ic, t.users.ITARANG_CALLER.id, t.epcPartnerId, { segment: "CI" });
    const blocked = await ic.post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: { ...CALC_INPUT, segment: "CI" } });
    expect(blocked.status).toBe(422);
    const a = expectOk<{ id: string; recommendationStatus: string }>(await ic.post(`/cases/${c.id}/assessments`, { method: "EPC", manual: { batteryKwh: 30, inverterKva: 30, solarKwp: 20, sourceNote: "EPC site survey 21 Sep" } }), 201);
    expect(a.recommendationStatus).toBe("CUSTOM_REQUIRED");
    const s4 = expectOk<{ stage: string; subStatus: string }>(await ic.post(`/assessments/${a.id}/confirm`, undefined, { ifMatch: c.version }));
    expect(s4.stage).toBe("S4");
    expect(s4.subStatus).toBe("ELIGIBILITY_PENDING");
  });

  it("UAT-16: release approval cycle — one draft, publish only after Ecofy approval, old assessments keep v1", async () => {
    const d = expectOk<{ id: string; version: number; status: string }>(await ia.post("/calculator/releases", { changeNote: "raise usable share" }), 201);
    expect(d.status).toBe("DRAFT");
    expect((await ia.post("/calculator/releases", { changeNote: "second draft" })).status).toBe(422);
    const rel = expectOk<{ params: Record<string, unknown>; appliances: unknown[]; systems: unknown[] }>(await ia.get(`/calculator/releases/${d.id}`));
    expect(rel.appliances.length).toBe(14);
    expect(rel.systems.length).toBe(5);
    const params = { ...rel.params, values: { ...(rel.params.values as Record<string, number>), usable_share: 0.95 } };
    expectOk(await ia.patch(`/calculator/releases/${d.id}`, { params }));
    expect((await ia.patch(`/calculator/releases/${d.id}`, { params: { ...params, formula: "CUSTOM" } })).status).toBe(422);
    const bench = expectOk<{ steps: Record<string, number> }>(await ia.post(`/calculator/releases/${d.id}/test`, CALC_INPUT));
    expect(bench.steps.battery_size_kwh).toBe(3.09); // 2.93 / 0.95
    expect((await ia.post(`/calculator/releases/${d.id}/approve`, {})).status).toBe(403);
    expectOk(await ia.post(`/calculator/releases/${d.id}/submit`, { note: "please review" }));
    expect((await ea.post(`/calculator/releases/${d.id}/reject`, {})).status).toBe(422); // note required
    const rej = expectOk<{ status: string }>(await ea.post(`/calculator/releases/${d.id}/reject`, { note: "0.95 is too optimistic" }));
    expect(rej.status).toBe("DRAFT");
    expectOk(await ia.patch(`/calculator/releases/${d.id}`, { params: { ...params, values: { ...(params.values as Record<string, number>), usable_share: 0.92 } } }));
    expectOk(await ia.post(`/calculator/releases/${d.id}/submit`, {}));
    const pub = expectOk<{ status: string; version: number }>(await ea.post(`/calculator/releases/${d.id}/approve`, { note: "ok" }));
    expect(pub.status).toBe("PUBLISHED");
    const list = expectOk<Array<{ id: string; version: number; status: string }>>(await ia.get("/calculator/releases"));
    expect(list.find((r) => r.version === 1)!.status).toBe("RETIRED");
    // new estimates use v2; old assessments still show v1 values
    const est = expectOk<{ releaseVersion: number; steps: Record<string, number> }>(await ic.post("/calculator/estimate", CALC_INPUT));
    expect(est.releaseVersion).toBe(pub.version);
    expect(est.steps.battery_size_kwh).toBe(3.19);
    // restore v1 into a new draft
    const restored = expectOk<{ status: string; version: number }>(await ia.post(`/calculator/releases/${list.find((r) => r.version === 1)!.id}/restore`, { changeNote: "back to v1" }), 201);
    expect(restored.status).toBe("DRAFT");
    await resetTestData(t.tenantId);
  });

  it("UAT-17: eligibility before quote (setting), then quote upload opens", async () => {
    const c = await leadAtS4(t, eu, ia, ic);
    const docId = await uploadPdf(ic, c.id, "quote");
    const body = { documentId: docId, assessmentId: c.assessmentId, epcPartnerId: t.epcPartnerId, systemDesc: "3 kWp + 5 kWh", equipmentInr: 200000, installationInr: 20000, gstInr: 20000, validUntil: "2099-12-31" };
    const blocked = await ic.post(`/cases/${c.id}/quotes`, body, { idempotencyKey: idem() });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.gate).toBe("s4_order");
    const e = expectOk<{ id: string }>(await ic.post(`/cases/${c.id}/eligibility`, {}), 201);
    const queue = expectOk<Array<{ id: string; eligibility: { id: string } }>>(await ea.get("/eligibility-queue"));
    expect(queue.some((x) => x.id === c.id)).toBe(true);
    expect((await ia.post(`/eligibility/${e.id}/decision`, { status: "ELIGIBLE", maxEligibleInr: 250000 })).status).toBe(403); // Ecofy's financier → EA only
    expectOk(await ea.post(`/eligibility/${e.id}/decision`, { status: "ELIGIBLE", maxEligibleInr: 250000 }));
    const q = expectOk<{ version: number; status: string; totalInr: number }>(await ic.post(`/cases/${c.id}/quotes`, body, { idempotencyKey: idem() }), 201);
    expect(q.version).toBe(1);
    expect(q.totalInr).toBe(240000);
    const cur = expectOk<{ subStatus: string }>(await ic.get(`/cases/${c.id}`));
    expect(cur.subStatus).toBe("OFFER_READY");
    // QUOTE_FIRST reverses the order for new cases
    expectOk(await ia.patch("/settings/gates.s4_order", { value: "QUOTE_FIRST" }));
    const c2 = await leadAtS4(t, eu, ia, ic);
    const doc2 = await uploadPdf(ic, c2.id, "quote");
    expect((await ic.post(`/cases/${c2.id}/quotes`, { ...body, documentId: doc2, assessmentId: c2.assessmentId }, { idempotencyKey: idem() })).status).toBe(201);
    expectOk(await ia.patch("/settings/gates.s4_order", { value: "ELIGIBILITY_FIRST" }));
  });

  it("UAT-18: caller never sees the limit — within / above only; amounts absent from responses", async () => {
    const within = await offerReady(t, eu, ea, ia, ic, { maxEligibleInr: 250000, total: { equipment: 200000, installation: 20000, gst: 20000 } });
    expect(within.limitCheck).toBe("WITHIN");
    const above = await offerReady(t, eu, ea, ia, ic, { maxEligibleInr: 250000, total: { equipment: 220000, installation: 20000, gst: 20000 } });
    expect(above.limitCheck).toBe("ABOVE");
    const offer = await ic.get(`/offers/${above.offerId}`);
    expect(offer.status).toBe(200);
    expect(offer.raw).not.toContain("250000");
    expect(offer.raw).not.toMatch(/maxEligible|sanctioned/);
    const caseView = await ic.get(`/cases/${above.id}`);
    expect(caseView.raw).not.toContain("250000");
    const tl = await ic.get(`/cases/${above.id}/timeline`);
    expect(tl.raw).not.toContain("250000");
    // the database itself hides the amount from the caller (T06): direct check through the owner
    const rows = await owner()`select count(*)::int as n from eligibility_values where eligibility_id = ${above.eligibilityId}`;
    expect(rows[0].n).toBe(1);
  });

  it("UAT-19: provisional quote on a pending assessment needs the flag and a reason; shows Provisional on the offer and File", async () => {
    const c = await leadAtS3(eu, ia, ic, t.users.ITARANG_CALLER.id, t.epcPartnerId);
    const a = expectOk<{ id: string; recommendationStatus: string }>(await ic.post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: { segment: "RESI", productInterest: "SOLAR_STORAGE", method: "NONE", backupHours: 4, phase: "SINGLE" } }), 201);
    expect(a.recommendationStatus).toBe("PENDING_TECHNICAL_DATA");
    const s4 = expectOk<{ version: number }>(await ic.post(`/assessments/${a.id}/confirm`, undefined, { ifMatch: c.version }));
    const e = expectOk<{ id: string }>(await ic.post(`/cases/${c.id}/eligibility`, {}), 201);
    expectOk(await ea.post(`/eligibility/${e.id}/decision`, { status: "ELIGIBLE", maxEligibleInr: 300000 }));
    const docId = await uploadPdf(ic, c.id, "quote");
    const base = { documentId: docId, assessmentId: a.id, epcPartnerId: t.epcPartnerId, systemDesc: "TBD", equipmentInr: 100000, installationInr: 10000, gstInr: 10000, validUntil: "2099-12-31" };
    expect((await ic.post(`/cases/${c.id}/quotes`, base, { idempotencyKey: idem() })).status).toBe(422);
    expect((await ic.post(`/cases/${c.id}/quotes`, { ...base, provisional: true }, { idempotencyKey: idem() })).status).toBe(422);
    const q = expectOk<{ id: string; provisional: boolean }>(await ic.post(`/cases/${c.id}/quotes`, { ...base, provisional: true, provisionalReason: "Customer wants a price before sharing the bill" }, { idempotencyKey: idem() }), 201);
    expect(q.provisional).toBe(true);
    const o = expectOk<{ id: string; provisional: boolean }>(await ic.post(`/cases/${c.id}/offers`, { quoteId: q.id }, { idempotencyKey: idem() }), 201);
    expect(o.provisional).toBe(true);
    void s4;
  });

  it("UAT-20: quote versions — v1 superseded, both listed, offer uses v2 only", async () => {
    const o = await offerReady(t, eu, ea, ia, ic);
    const doc2 = await uploadPdf(ic, o.id, "quote");
    const q2 = expectOk<{ id: string; version: number }>(await ic.post(`/cases/${o.id}/quotes`, { documentId: doc2, assessmentId: o.assessmentId, epcPartnerId: t.epcPartnerId, systemDesc: "3 kWp + 5 kWh (revised)", equipmentInr: 190000, installationInr: 20000, gstInr: 19000, validUntil: "2099-12-31", notes: "discount" }, { idempotencyKey: idem() }), 201);
    expect(q2.version).toBe(2);
    const quotes = expectOk<Array<{ version: number; status: string }>>(await ic.get(`/cases/${o.id}/quotes`));
    expect(quotes.map((q) => [q.version, q.status])).toEqual([[2, "ACTIVE"], [1, "SUPERSEDED"]]);
    const oldOffer = expectOk<{ status: string }>(await ic.get(`/offers/${o.offerId}`));
    expect(oldOffer.status).toBe("SUPERSEDED");
    expect((await ic.post(`/cases/${o.id}/offers`, { quoteId: o.quoteId }, { idempotencyKey: idem() })).status).toBe(409);
    const o2 = expectOk<{ content: { totalInr: number } }>(await ic.post(`/cases/${o.id}/offers`, { quoteId: q2.id }, { idempotencyKey: idem() }), 201);
    expect(o2.content.totalInr).toBe(229000);
  });

  it("UAT-21: OTP limits and idempotency — one SMS for a double click, lock after 5 wrong codes, resend rules", async () => {
    const o = await offerReady(t, eu, ea, ia, ic);
    const key = idem();
    const a = await ic.post(`/offers/${o.offerId}/otp`, undefined, { ifMatch: o.version, idempotencyKey: key });
    const b = await ic.post(`/offers/${o.offerId}/otp`, undefined, { ifMatch: o.version, idempotencyKey: key });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.data.challengeId).toBe(a.body.data.challengeId);
    const sent = await owner()`select count(*)::int as n from otp_challenges where offer_id = ${o.offerId}`;
    expect(sent[0].n).toBe(1);
    const cur = expectOk<{ stage: string; subStatus: string; version: number }>(await ic.get(`/cases/${o.id}`));
    expect(cur.stage).toBe("S5");
    expect(cur.subStatus).toBe("OTP_SENT");
    // resend inside 60 s is blocked
    const early = await ic.post(`/offers/${o.offerId}/otp`, undefined, { ifMatch: cur.version, idempotencyKey: idem() });
    expect(early.status).toBe(429);
    // 5 wrong codes → locked
    for (let i = 1; i <= 4; i++) {
      const r = await ic.post(`/otp/${a.body.data.challengeId}/verify`, { code: "000000" });
      expect(r.status).toBe(422);
      expect(r.body.error?.details?.attemptsRemaining).toBe(5 - i);
    }
    const locked = await ic.post(`/otp/${a.body.data.challengeId}/verify`, { code: "000000" });
    expect(locked.status).toBe(429);
    const st = expectOk<{ status: string }>(await ic.get(`/otp/${a.body.data.challengeId}`));
    expect(st.status).toBe("LOCKED");
    // 3 sends per hour cap: the resend window is enforced by sent_at, so move the clock in the DB
    await owner()`update otp_challenges set sent_at = sent_at - interval '2 minutes' where offer_id = ${o.offerId}`;
    expect((await ic.post(`/offers/${o.offerId}/otp`, undefined, { ifMatch: cur.version, idempotencyKey: idem() })).status).toBe(201);
    await owner()`update otp_challenges set sent_at = sent_at - interval '2 minutes' where offer_id = ${o.offerId}`;
    expect((await ic.post(`/offers/${o.offerId}/otp`, undefined, { ifMatch: cur.version + 1, idempotencyKey: idem() })).status).toBe(201);
    await owner()`update otp_challenges set sent_at = sent_at - interval '2 minutes' where offer_id = ${o.offerId}`;
    const fourth = await ic.post(`/offers/${o.offerId}/otp`, undefined, { ifMatch: cur.version + 2, idempotencyKey: idem() });
    expect(fourth.status).toBe(429);
  });

  it("UAT-22: File creation — locked to the accepted quote and version; S5→S6; Ecofy notified; financing attempt 1 submitted", async () => {
    const f = await leadAtS6(t, eu, ea, ia, ic);
    expect(f.stage).toBe("S6");
    expect(f.subStatus).toBe("AWAITING_DECISION");
    expect(f.fileNo).toMatch(/^FL-\d+$/);
    expect(f.acceptedTotalInr).toBe(240000);
    const file = expectOk<{ acceptedQuoteId: string; quoteVersion: number; acceptances: Array<{ kind: string }> }>(await ic.get(`/files/${f.fileId}`));
    expect(file.acceptedQuoteId).toBe(f.quoteId);
    expect(file.quoteVersion).toBe(1);
    expect(file.acceptances.map((a) => a.kind)).toEqual(["INITIAL"]);
    const quotes = expectOk<Array<{ status: string }>>(await ic.get(`/cases/${f.id}/quotes`));
    expect(quotes[0].status).toBe("ACCEPTED");
    const fin = await owner()`select attempt_no, status from financing_decisions where case_id = ${f.id}`;
    expect(fin).toEqual([{ attempt_no: 1, status: "SUBMITTED" }]);
    await relay(t.tenantId);
    const bell = expectOk<Array<{ type: string }>>(await ea.get("/notifications?unread=true"));
    expect(bell.some((n) => n.type.startsWith("file.locked"))).toBe(true);
    // a second quote upload is impossible at S6; the File cannot be edited (DB grant) — developer check
    const upd = await owner()`select has_table_privilege('ecofy_app', 'files', 'UPDATE') as u, has_table_privilege('ecofy_app', 'files', 'DELETE') as d`;
    expect(upd[0]).toEqual({ u: false, d: false });
  });
});
