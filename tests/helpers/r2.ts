/** R2 flow helpers: upload an EPC quote PDF through the local storage adapter, compose the offer, send/verify the OTP. */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ApiClient } from "./api";
import { expectOk, idem } from "./api";
import { leadAtS3 } from "./fixtures";
import type { TestTenant } from "./testDb";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

/** Presigned PUT emulation: write straight to the local storage dir (the dev-storage route would do the same). */
export async function uploadPdf(ic: ApiClient, caseId: string, kind: "quote" | "document", typeCode = "EPC_QUOTE") {
  const body = { typeCode, fileName: `${typeCode.toLowerCase()}.pdf`, mimeType: "application/pdf", sizeBytes: PDF.length };
  const ticket = expectOk<{ id: string; uploadUrl: string }>(await ic.post(kind === "quote" ? `/cases/${caseId}/quotes/upload-url` : `/cases/${caseId}/documents/upload-url`, body), 201);
  const key = decodeURIComponent(new URL(ticket.uploadUrl).pathname.replace(/^\/api\/dev-storage\//, ""));
  const root = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".data/test-storage");
  await fs.mkdir(path.dirname(path.join(root, key)), { recursive: true });
  await fs.writeFile(path.join(root, key), PDF);
  await fs.writeFile(path.join(root, key) + ".meta", "application/pdf");
  const sha = createHash("sha256").update(PDF).digest("hex");
  const doc = expectOk<{ id: string }>(await ic.post(`/cases/${caseId}/documents`, { documentId: ticket.id, sha256: sha }), 201);
  return doc.id;
}

export async function uploadImage(ic: ApiClient, caseId: string, typeCode: string) {
  const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const ticket = expectOk<{ id: string; uploadUrl: string }>(await ic.post(`/cases/${caseId}/documents/upload-url`, { typeCode, fileName: `${typeCode.toLowerCase()}.png`, mimeType: "image/png", sizeBytes: PNG.length }), 201);
  const key = decodeURIComponent(new URL(ticket.uploadUrl).pathname.replace(/^\/api\/dev-storage\//, ""));
  const root = path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".data/test-storage");
  await fs.mkdir(path.dirname(path.join(root, key)), { recursive: true });
  await fs.writeFile(path.join(root, key), PNG);
  const sha = createHash("sha256").update(PNG).digest("hex");
  return expectOk<{ id: string }>(await ic.post(`/cases/${caseId}/documents`, { documentId: ticket.id, sha256: sha }), 201).id;
}

export const CALC_INPUT = { segment: "RESI", productInterest: "SOLAR_STORAGE", method: "APPLIANCES", appliances: [{ applianceName: "Ceiling fan", watts: 75, quantity: 4 }, { applianceName: "LED bulb", watts: 10, quantity: 6 }, { applianceName: "Television", watts: 100, quantity: 1 }, { applianceName: "Refrigerator", watts: 200, quantity: 1 }], monthlyUnits: 300, backupHours: 4, phase: "SINGLE" };

/** Case at S4 (assessment confirmed) with a saved calculator assessment. */
export async function leadAtS4(t: TestTenant, eu: ApiClient, ia: ApiClient, ic: ApiClient, overrides: Record<string, unknown> = {}) {
  const c = await leadAtS3(eu, ia, ic, t.users.ITARANG_CALLER.id, t.epcPartnerId, overrides);
  const a = expectOk<{ id: string; recommendationStatus: string }>(await ic.post(`/cases/${c.id}/assessments`, { method: "CALCULATOR", calculator: CALC_INPUT }), 201);
  const s4 = expectOk<{ version: number; stage: string; subStatus: string }>(await ic.post(`/assessments/${a.id}/confirm`, undefined, { ifMatch: c.version }));
  return { id: c.id, caseNo: c.caseNo, version: s4.version, stage: s4.stage, assessmentId: a.id, recommendationStatus: a.recommendationStatus };
}

/** Eligible (EA records max amount) + ACTIVE quote + composed offer. */
export async function offerReady(t: TestTenant, eu: ApiClient, ea: ApiClient, ia: ApiClient, ic: ApiClient, opts: { maxEligibleInr?: number; total?: { equipment: number; installation: number; gst: number }; provisional?: { reason: string } } = {}) {
  const c = await leadAtS4(t, eu, ia, ic);
  const e = expectOk<{ id: string }>(await ic.post(`/cases/${c.id}/eligibility`, {}), 201);
  expectOk(await ea.post(`/eligibility/${e.id}/decision`, { status: "ELIGIBLE", maxEligibleInr: opts.maxEligibleInr ?? 250000 }));
  const docId = await uploadPdf(ic, c.id, "quote");
  const amounts = opts.total ?? { equipment: 200000, installation: 20000, gst: 20000 };
  const q = expectOk<{ id: string; version: number; totalInr: number }>(await ic.post(`/cases/${c.id}/quotes`, { documentId: docId, assessmentId: c.assessmentId, epcPartnerId: t.epcPartnerId, systemDesc: "3 kWp + 5 kWh", equipmentInr: amounts.equipment, installationInr: amounts.installation, gstInr: amounts.gst, validUntil: "2099-12-31", ...(opts.provisional ? { provisional: true, provisionalReason: opts.provisional.reason } : {}) }, { idempotencyKey: idem() }), 201);
  const o = expectOk<{ id: string; limitCheck: string; version: number }>(await ic.post(`/cases/${c.id}/offers`, { quoteId: q.id }, { idempotencyKey: idem() }), 201);
  const cur = expectOk<{ version: number }>(await ic.get(`/cases/${c.id}`));
  return { ...c, version: cur.version, quoteId: q.id, quoteVersion: q.version, totalInr: q.totalInr, offerId: o.id, limitCheck: o.limitCheck, eligibilityId: e.id };
}

/** Reads the last OTP sent to a mobile from the dev SMS adapter output. */
export async function lastOtp(): Promise<string> {
  const dir = path.resolve(process.cwd(), process.env.DEV_SMS_DIR ?? ".data/test-sms");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const last = JSON.parse(await fs.readFile(path.join(dir, files[files.length - 1]), "utf8")) as { text: string };
  const m = /\b(\d{6})\b/.exec(last.text);
  if (!m) throw new Error("no OTP in last sms: " + last.text);
  return m[1];
}

/** Runs the worker relay once for the test tenant (inline queue → handlers in-process). */
export async function relay(tenantId: string) {
  const { queue } = await import("@/adapters");
  const { relayOnce } = await import("@/worker/relay");
  const { registerAllHandlers } = await import("@/worker/handlers");
  const { dispatch } = await import("@/worker/handlers/registry");
  registerAllHandlers();
  const q = await queue();
  await q.start(dispatch);
  let n = 0, total = 0;
  do { n = await relayOnce(tenantId, q); total += n; } while (n > 0);
  return total;
}

/** Case with a File (S6 AWAITING_DECISION). */
export async function leadAtS6(t: TestTenant, eu: ApiClient, ea: ApiClient, ia: ApiClient, ic: ApiClient, opts: Parameters<typeof offerReady>[5] = {}) {
  const o = await offerReady(t, eu, ea, ia, ic, opts);
  const otp = expectOk<{ challengeId: string }>(await ic.post(`/offers/${o.offerId}/otp`, undefined, { ifMatch: o.version, idempotencyKey: idem() }), 201);
  await relay(t.tenantId);
  const code = await lastOtp();
  const file = expectOk<{ id: string; fileNo: string; acceptedTotalInr: number }>(await ic.post(`/otp/${otp.challengeId}/verify`, { code }));
  const cur = expectOk<{ version: number; stage: string; subStatus: string }>(await ic.get(`/cases/${o.id}`));
  return { ...o, version: cur.version, stage: cur.stage, subStatus: cur.subStatus, fileId: file.id, fileNo: file.fileNo, acceptedTotalInr: file.acceptedTotalInr };
}
