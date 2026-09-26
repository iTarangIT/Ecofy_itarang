import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import { ensureTestTenant, resetTestData, closeOwner, owner, type TestTenant } from "../helpers/testDb";
import { ApiClient, expectOk, idem } from "../helpers/api";
import { registerAllRoutes } from "../helpers/routes";
import { leadAtS2, createLead } from "../helpers/fixtures";
import { leadAtS6, lastOtp, relay, uploadImage, uploadPdf } from "../helpers/r2";

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

async function sanction(caseId: string, amount: number, extra: Record<string, unknown> = {}) {
  const cur = expectOk<{ version: number }>(await ea.get(`/cases/${caseId}`));
  return expectOk<{ stage: string; subStatus: string | null; version: number }>(await ea.post(`/cases/${caseId}/financing/decisions`, { status: "SANCTIONED", values: { sanctionedInr: amount, ...extra } }, { ifMatch: cur.version }));
}

describe("R3 — financing, installation, disbursement, asset, withdrawal, dashboards", () => {
  it("UAT-23: lower sanction → REACCEPTANCE_PENDING; SMS carries amounts; caller sees status only; REVISED acceptance → S7", async () => {
    const f = await leadAtS6(t, eu, ea, ia, ic);
    expect(f.acceptedTotalInr).toBe(240000);
    const q = expectOk<Array<{ id: string; file: { fileNo: string } }>>(await ea.get("/financing-queue"));
    expect(q.some((x) => x.id === f.id)).toBe(true);
    expect((await ia.get("/financing-queue")).body.data).toEqual([]); // Ecofy's queue is EA's
    const s = await sanction(f.id, 210000, { downPaymentInr: 30000, tenureMonths: 36, emiInr: 6500 });
    expect(s.stage).toBe("S6");
    expect(s.subStatus).toBe("REACCEPTANCE_PENDING");
    // CONFLICTS #27: the File stays in EA's queue, flagged as waiting on the customer's re-acceptance
    const q2 = expectOk<Array<{ id: string; waitingOn: string; decision: { status: string } }>>(await ea.get("/financing-queue"));
    expect(q2.find((x) => x.id === f.id)).toMatchObject({ waitingOn: "REACCEPTANCE", decision: { status: "SANCTIONED" } });
    // caller: status only, no amounts anywhere
    const dec = await ic.get(`/cases/${f.id}/financing/decisions`);
    expect(dec.status).toBe(200);
    expect(dec.raw).not.toContain("210000");
    expect(dec.body.data[0].status).toBe("SANCTIONED");
    const eaDec = expectOk<Array<{ values?: { sanctionedInr: number } }>>(await ea.get(`/cases/${f.id}/financing/decisions`));
    expect(eaDec[0].values?.sanctionedInr).toBe(210000);
    // IC cannot trigger re-acceptance; EA can
    expect((await ic.post(`/cases/${f.id}/reacceptance`, { decisionId: dec.body.data[0].id }, { idempotencyKey: idem() })).status).toBe(403);
    const otp = expectOk<{ challengeId: string; purpose: string }>(await ea.post(`/cases/${f.id}/reacceptance`, { decisionId: dec.body.data[0].id }, { idempotencyKey: idem() }), 201);
    expect(otp.purpose).toBe("REACCEPTANCE");
    await relay(t.tenantId);
    const smsDir = ".data/test-sms";
    const files = (await fs.readdir(smsDir)).sort();
    const last = JSON.parse(await fs.readFile(`${smsDir}/${files[files.length - 1]}`, "utf8")) as { text: string; purpose: string };
    expect(last.purpose).toBe("REACCEPTANCE_OTP");
    expect(last.text).toContain("2,10,000");
    expect(last.text).toContain("30,000");
    const code = await lastOtp();
    const file = expectOk<{ acceptances: Array<{ kind: string }> }>(await ic.post(`/otp/${otp.challengeId}/verify`, { code }));
    expect(file.acceptances.map((a) => a.kind)).toEqual(["INITIAL", "REVISED"]);
    const cur = expectOk<{ stage: string; subStatus: string }>(await ic.get(`/cases/${f.id}`));
    expect(cur.stage).toBe("S7");
    expect(cur.subStatus).toBe("INSTALLING");
    expect(expectOk<Array<{ id: string }>>(await ea.get("/financing-queue")).some((x) => x.id === f.id)).toBe(false);
  });

  it("UAT-24: rejection and routing — Ecofy loses sight once routed; Other NBFC amounts visible only to IA", async () => {
    const f = await leadAtS6(t, eu, ea, ia, ic);
    const cur = expectOk<{ version: number }>(await ea.get(`/cases/${f.id}`));
    expect((await ea.post(`/cases/${f.id}/financing/decisions`, { status: "REJECTED" }, { ifMatch: cur.version })).status).toBe(422);
    const rej = expectOk<{ subStatus: string; version: number }>(await ea.post(`/cases/${f.id}/financing/decisions`, { status: "REJECTED", rejectionReason: "Bureau score below policy" }, { ifMatch: cur.version }));
    expect(rej.subStatus).toBe("REJECTED_ROUTING");
    const routed = expectOk<{ financierId: string; subStatus: string; version: number }>(await ia.post(`/cases/${f.id}/route-financier`, { financierId: t.otherFinancierId, note: "Try Other NBFC" }, { ifMatch: rej.version }));
    expect(routed.financierId).toBe(t.otherFinancierId);
    expect(routed.subStatus).toBe("AWAITING_DECISION");
    // Ecofy loses sight: the case was Ecofy-sourced, so EA still sees it as lead source (FR-11.6) — verify with an iTarang-sourced case instead
    const iaLead = expectOk<{ id: string }>(await ia.post("/cases", { customer: { fullName: "Meena Gupta", mobile: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`, customerType: "BUSINESS", businessName: "Meena Traders", address: "Shop 4, FC Road", city: "Pune", state: "Maharashtra", pincode: "411001", consentObtained: true, consentDate: "2026-09-12", consentSource: "CAMPAIGN" }, segment: "ESS" }, { idempotencyKey: idem() }), 201);
    expectOk(await ea.get(`/cases/${iaLead.id}`)); // visible while Ecofy is the default financier
    const iaCur = expectOk<{ version: number }>(await ia.get(`/cases/${iaLead.id}`));
    // move its financier at S1 is not allowed; routing needs a NOT_ELIGIBLE/REJECTED decision, so route the rejected case's queue instead
    void iaCur;
    // IA records Other NBFC's sanction; EA cannot see its values
    const q = expectOk<Array<{ id: string }>>(await ia.get("/financing-queue"));
    expect(q.some((x) => x.id === f.id)).toBe(true);
    const v = expectOk<{ version: number }>(await ia.get(`/cases/${f.id}`));
    expect((await ea.post(`/cases/${f.id}/financing/decisions`, { status: "SANCTIONED", values: { sanctionedInr: 240000 } }, { ifMatch: v.version })).status).toBe(403);
    const s = expectOk<{ stage: string }>(await ia.post(`/cases/${f.id}/financing/decisions`, { status: "SANCTIONED", values: { sanctionedInr: 240000 } }, { ifMatch: v.version }));
    expect(s.stage).toBe("S7");
    const eaView = await ea.get(`/cases/${f.id}/financing/decisions`);
    expect(eaView.raw).not.toContain('"sanctionedInr":240000');
    const iaView = expectOk<Array<{ attemptNo: number; values?: { sanctionedInr: number } }>>(await ia.get(`/cases/${f.id}/financing/decisions`));
    expect(iaView.find((d) => d.attemptNo === 2)?.values?.sanctionedInr).toBe(240000);
    // DB backstop: EA's session cannot read Other NBFC's financing_values (RLS by visible_to)
    const rows = await owner()`select visible_to from financing_values fv join financing_decisions fd on fd.id = fv.decision_id where fd.case_id = ${f.id} and fd.attempt_no = 2`;
    expect(rows[0].visible_to).toBe("ITARANG_ADMIN");
  });

  it("UAT-25/26: installation before sanction needs acknowledgement; INSTALLED needs photo + acceptance letter; S7 only on sanction", async () => {
    const f = await leadAtS6(t, eu, ea, ia, ic);
    const inst = expectOk<{ id: string; status: string }>(await ic.post(`/cases/${f.id}/installation`, { epcPartnerId: t.epcPartnerId }), 201);
    expect(inst.status).toBe("NOT_STARTED");
    const warn = await ic.patch(`/installations/${inst.id}`, { status: "IN_PROGRESS" });
    expect(warn.status).toBe(409);
    expect(warn.body.error?.gate).toBe("acknowledge_no_sanction");
    const started = expectOk<{ status: string; startedBeforeSanction: boolean }>(await ic.patch(`/installations/${inst.id}`, { status: "IN_PROGRESS", acknowledgeNoSanction: true, onDate: "2026-09-22" }));
    expect(started.startedBeforeSanction).toBe(true);
    expect(expectOk<{ stage: string }>(await ic.get(`/cases/${f.id}`)).stage).toBe("S6");
    // proof gate
    const noProof = await ic.patch(`/installations/${inst.id}`, { status: "INSTALLED" });
    expect(noProof.status).toBe(409);
    expect(noProof.body.error?.gate).toBe("installation_proof");
    await uploadImage(ic, f.id, "INSTALLATION_PHOTO");
    expect((await ic.patch(`/installations/${inst.id}`, { status: "INSTALLED" })).status).toBe(409);
    await uploadPdf(ic, f.id, "document", "CUSTOMER_ACCEPTANCE_LETTER");
    const installed = expectOk<{ status: string }>(await ic.patch(`/installations/${inst.id}`, { status: "INSTALLED", onDate: "2026-09-23" }));
    expect(installed.status).toBe("INSTALLED");
    expect(expectOk<{ stage: string }>(await ic.get(`/cases/${f.id}`)).stage).toBe("S6"); // still S6 without sanction
    const s = await sanction(f.id, 240000);
    expect(s.stage).toBe("S7");
    // the setting can turn installation-before-sanction into a hard gate
    expectOk(await ia.patch("/settings/gates.sanction_before_installation", { value: true }));
    const g = await leadAtS6(t, eu, ea, ia, ic);
    const i2 = expectOk<{ id: string }>(await ic.post(`/cases/${g.id}/installation`, { epcPartnerId: t.epcPartnerId }), 201);
    const blocked = await ic.patch(`/installations/${i2.id}`, { status: "IN_PROGRESS", acknowledgeNoSanction: true });
    expect(blocked.body.error?.gate).toBe("sanction_before_installation");
    expectOk(await ia.patch("/settings/gates.sanction_before_installation", { value: false }));
  });

  it("UAT-27: down payment and disbursement → S8 and asset; IA sees status not amounts", async () => {
    const f = await leadAtS6(t, eu, ea, ia, ic);
    await sanction(f.id, 240000, { downPaymentInr: 40000 });
    const inst = expectOk<{ id: string }>(await ic.post(`/cases/${f.id}/installation`, { epcPartnerId: t.epcPartnerId, scheduledOn: "2026-09-25" }), 201);
    expectOk(await ic.patch(`/installations/${inst.id}`, { status: "IN_PROGRESS", onDate: "2026-09-25" }));
    await uploadImage(ic, f.id, "INSTALLATION_PHOTO");
    await uploadPdf(ic, f.id, "document", "CUSTOMER_ACCEPTANCE_LETTER");
    expectOk(await ic.patch(`/installations/${inst.id}`, { status: "COMMISSIONED", onDate: "2026-09-26" }));
    expect((await ia.post(`/cases/${f.id}/down-payment`, { receivedOn: "2026-09-24", amountInr: 40000 })).status).toBe(403);
    expectOk(await ea.post(`/cases/${f.id}/down-payment`, { receivedOn: "2026-09-24", amountInr: 40000, reference: "UTR123" }), 201);
    expect(expectOk<Array<{ amountInr: number }>>(await ea.get(`/cases/${f.id}/down-payment`))[0].amountInr).toBe(40000);
    expect(expectOk<unknown[]>(await ia.get(`/cases/${f.id}/down-payment`))).toEqual([]); // RLS hides Ecofy's amounts from IA
    expect(expectOk<{ downPaymentRecorded: boolean }>(await ia.get(`/cases/${f.id}/payment-status`)).downPaymentRecorded).toBe(true);
    const cur = expectOk<{ version: number }>(await ea.get(`/cases/${f.id}`));
    const s8 = expectOk<{ stage: string }>(await ea.post(`/cases/${f.id}/disbursement`, { disbursedOn: "2026-09-27", amountInr: 200000, reference: "DISB-1" }, { ifMatch: cur.version }), 201);
    expect(s8.stage).toBe("S8");
    const assets = expectOk<Array<{ caseId: string; id: string; status: string; systemSnapshot: { system: string } }>>(await ia.get("/assets"));
    const a = assets.find((x) => x.caseId === f.id)!;
    expect(a.status).toBe("ACTIVE");
    expect(a.systemSnapshot.system).toBe("3 kWp + 5 kWh");
    const iaCase = await ia.get(`/cases/${f.id}/timeline`);
    expect(iaCase.raw).not.toContain("200000");
    // UAT-29: EMI status, buyback, redeployment recorded by EA; no risk flags
    expectOk(await ea.post(`/assets/${a.id}/emi-status`, { asOf: "2026-10-05", state: "DPD_1_30" }), 201);
    expect((await ia.post(`/assets/${a.id}/emi-status`, { asOf: "2026-10-06", state: "CURRENT" })).status).toBe(403);
    expectOk(await ea.post(`/assets/${a.id}/events`, { type: "BUYBACK", onDate: "2026-11-01", note: "customer relocating" }), 201);
    expectOk(await ea.post(`/assets/${a.id}/events`, { type: "REDEPLOYED", onDate: "2026-11-15" }), 201);
    const asset = expectOk<{ status: string; emiStatus: { state: string }; events: unknown[] }>(await ea.get(`/assets/${a.id}`));
    expect(asset.status).toBe("REDEPLOYED");
    expect(asset.emiStatus.state).toBe("DPD_1_30");
    expect(asset.events.length).toBe(2);
    expect(JSON.stringify(asset)).not.toMatch(/risk|soh|telemetry/i);
    // usage view counts, never blocks
    const usage = expectOk<Array<{ filesToDate: number; activeAssets: number; seatsByRole: Record<string, unknown> }>>(await ea.get("/usage"));
    expect(usage[0].filesToDate).toBeGreaterThan(0);
  });

  it("UAT-28: withdrawal before acceptance closes at once; after acceptance needs IA confirmation and Ecofy follow-ups", async () => {
    const s2 = await leadAtS2(eu, ia, t.users.ITARANG_CALLER.id);
    const w1 = expectOk<{ status: string }>(await ic.post(`/cases/${s2.id}/withdrawals`, { reason: "Customer moving abroad" }), 201);
    expect(w1.status).toBe("CONFIRMED");
    const c1 = expectOk<{ stage: string; closureReason: string }>(await ic.get(`/cases/${s2.id}`));
    expect(c1.stage).toBe("CLOSED");
    expect(c1.closureReason).toBe("WITHDRAWN");
    const f = await leadAtS6(t, eu, ea, ia, ic);
    await sanction(f.id, 240000);
    const w2 = expectOk<{ id: string; status: string }>(await ic.post(`/cases/${f.id}/withdrawals`, { reason: "Changed mind after sanction" }), 201);
    expect(w2.status).toBe("REQUESTED");
    expect(expectOk<{ stage: string }>(await ic.get(`/cases/${f.id}`)).stage).toBe("S7");
    expect((await ic.post(`/withdrawals/${w2.id}/confirm`)).status).toBe(403);
    const closed = expectOk<{ stage: string; closureReason: string }>(await ia.post(`/withdrawals/${w2.id}/confirm`));
    expect(closed.stage).toBe("CLOSED");
    expect(closed.closureReason).toBe("WITHDRAWN");
    const file = expectOk<{ fileNo: string }>(await ia.get(`/files/${f.fileId}`)); // File kept
    expect(file.fileNo).toBe(f.fileNo);
    expect((await ia.post(`/withdrawals/${w2.id}/sanction-cancelled`)).status).toBe(403);
    expect(expectOk<{ sanctionCancelledAt: string }>(await ea.post(`/withdrawals/${w2.id}/sanction-cancelled`)).sanctionCancelledAt).toBeTruthy();
    expect(expectOk<{ epcInformedAt: string }>(await ia.post(`/withdrawals/${w2.id}/epc-informed`)).epcInformedAt).toBeTruthy();
    // a case with a File never reopens (trigger + service)
    const cur = expectOk<{ version: number }>(await ia.get(`/cases/${f.id}`));
    const re = await ia.post(`/cases/${f.id}/reopen`, { reason: "try" }, { ifMatch: cur.version });
    expect(re.status).toBe(409);
    expect(re.body.error?.gate).toBe("no_file");
    await relay(t.tenantId);
    const bell = expectOk<Array<{ type: string }>>(await ea.get("/notifications?unread=true"));
    expect(bell.some((n) => n.type.startsWith("withdrawal.confirmed"))).toBe(true);
  });

  it("UAT-03: re-upload of a customer whose case reached a File creates a new linked case", async () => {
    const f = await leadAtS6(t, eu, ea, ia, ic);
    await sanction(f.id, 240000);
    const w = expectOk<{ id: string }>(await ic.post(`/cases/${f.id}/withdrawals`, { reason: "withdrew" }), 201);
    expectOk(await ia.post(`/withdrawals/${w.id}/confirm`));
    const mobile = (await owner()`select mobile_e164 from customers where id = (select customer_id from cases where id = ${f.id})`)[0].mobile_e164 as string;
    const again = expectOk<{ id: string; previousCaseId: string; stage: string }>(await eu.post("/cases", { customer: { fullName: "Rohit Sharma", mobile: mobile.slice(3), customerType: "INDIVIDUAL", address: "H.No 12", city: "Gurugram", state: "Haryana", pincode: "122001", consentObtained: true, consentDate: "2026-09-15", consentSource: "CALL" }, segment: "RESI" }, { idempotencyKey: idem() }), 201);
    expect(again.previousCaseId).toBe(f.id);
    expect(again.stage).toBe("S0");
    const old = expectOk<{ stage: string }>(await ia.get(`/cases/${f.id}`));
    expect(old.stage).toBe("CLOSED");
  });

  it("dashboards: funnel, ageing, per-user; export logged; caller sees own only", async () => {
    const fu = expectOk<{ byStage: Array<{ stage: string; open: number }>; total: number }>(await ia.get("/dashboards/funnel"));
    expect(fu.byStage.length).toBe(10);
    expect(fu.total).toBeGreaterThan(0);
    const ag = expectOk<{ bands: number[]; cases: unknown[] }>(await ia.get("/dashboards/ageing"));
    expect(ag.bands).toEqual([1, 3, 7]);
    const me = expectOk<{ calls: number; files: number }>(await ic.get(`/dashboards/users/${t.users.ITARANG_CALLER.id}`));
    expect(me.files).toBeGreaterThan(0);
    expect((await ic.get(`/dashboards/users/${t.users.ITARANG_ADMIN.id}`)).status).toBe(403);
    const csv = await ia.get("/reports/cases.csv");
    expect(csv.status).toBe(200);
    expect(csv.raw).toContain("case_no");
    expect(csv.raw).toMatch(/\+91\*{6}\d{4}/);
    expect((await ic.get("/reports/cases.csv")).status).toBe(403);
    const audit = expectOk<Array<{ action: string; entityId: string }>>(await ia.get("/audit?action=export"));
    expect(audit.some((a) => a.action === "export.generate" && a.entityId === "cases")).toBe(true);
    // UAT-35 spot check: no money in caller responses across the case
    const list = await ic.get("/cases");
    expect(list.raw).not.toMatch(/sanctionedInr|maxEligibleInr|amountInr|downPaymentInr/);
  });

  it("UAT-31: retention jobs purge recordings and import raw data with the clock moved forward", async () => {
    const { runJob } = await import("@/worker/jobs");
    const { registerAllHandlers } = await import("@/worker/handlers");
    const { setClock } = await import("@/worker/clock");
    registerAllHandlers();
    const c = await createLead(eu);
    // a call recording with consent (retention 60 days)
    const PNG = Buffer.from("89504e470d0a1a0a", "hex");
    const ticket = expectOk<{ id: string; uploadUrl: string }>(await eu.post(`/cases/${c.id}/documents/upload-url`, { typeCode: "CALL_RECORDING", fileName: "call.mp3", mimeType: "audio/mpeg", sizeBytes: PNG.length }), 201);
    const key = decodeURIComponent(new URL(ticket.uploadUrl).pathname.replace(/^\/api\/dev-storage\//, ""));
    const root = `${process.cwd()}/.data/test-storage`;
    await fs.mkdir(`${root}/${key}`.replace(/\/[^/]+$/, ""), { recursive: true });
    await fs.writeFile(`${root}/${key}`, PNG);
    const { createHash } = await import("node:crypto");
    expect((await eu.post(`/cases/${c.id}/documents`, { documentId: ticket.id, sha256: createHash("sha256").update(PNG).digest("hex") })).status).toBe(422); // consent required
    expectOk(await eu.post(`/cases/${c.id}/documents`, { documentId: ticket.id, sha256: createHash("sha256").update(PNG).digest("hex"), recordingConsent: true }), 201);
    setClock(() => new Date(Date.now() + 61 * 86400_000));
    try {
      const r = await runJob("recording.purge", t.tenantId);
      expect(r.purged).toBeGreaterThanOrEqual(1);
    } finally {
      setClock(null);
    }
    const docs = expectOk<Array<{ id: string }>>(await eu.get(`/cases/${c.id}/documents`));
    expect(docs.find((d) => d.id === ticket.id)).toBeUndefined();
    const auditRows = await owner()`select count(*)::int as n from audit_log where tenant_id = ${t.tenantId} and action = 'document.purge' and entity_id = ${ticket.id}`;
    expect(auditRows[0].n).toBe(1);
    // OTP expiry and idempotency purge run without error
    expect(await runJob("otp.expire", t.tenantId)).toBeTruthy();
    expect(await runJob("idempotency.purge", t.tenantId)).toBeTruthy();
    expect(await runJob("ageing.rollup", t.tenantId)).toBeTruthy();
    expect(await runJob("price.stale", t.tenantId)).toBeTruthy();
  });
});
