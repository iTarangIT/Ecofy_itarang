import type { ApiClient } from "./api";
import { expectOk, idem } from "./api";

let n = Math.floor(Date.now() / 1000) % 10_000_000; // unique per run, unique per call
export function mobile() {
  n++;
  return `9${String(n).padStart(9, "0")}`;
}

export function customer(overrides: Record<string, unknown> = {}) {
  return {
    fullName: "Rohit Sharma", mobile: mobile(), customerType: "INDIVIDUAL", address: "H.No 12, Sector 45", city: "Gurugram", state: "Haryana", pincode: "122001",
    consentObtained: true, consentDate: "2026-09-15", consentSource: "WEBSITE_FORM", preferredLanguage: "HINDI", propertyType: "OWN_HOUSE", ...overrides,
  };
}

/** Ecofy User creates a lead at S0 (owner Ecofy, qualifier = EU). */
export async function createLead(eu: ApiClient, overrides: Record<string, unknown> = {}) {
  const r = await eu.post("/cases", { customer: customer(), segment: "RESI", productInterest: "SOLAR_STORAGE", avgMonthlyBillInr: 4500, sanctionedLoadKw: 5, ...overrides }, { idempotencyKey: idem() });
  return expectOk<{ id: string; caseNo: string; version: number; stage: string }>(r, 201);
}

/** Drives a fresh lead to S2 assigned to the caller: EU marks Hot → IA assigns IC. */
export async function leadAtS2(eu: ApiClient, ia: ApiClient, callerId: string, overrides: Record<string, unknown> = {}) {
  const c = await createLead(eu, overrides);
  const hot = expectOk<{ version: number; stage: string }>(await eu.post(`/cases/${c.id}/temperature`, { temperature: "HOT" }, { ifMatch: c.version }));
  const s2 = expectOk<{ id: string; version: number; stage: string }>(await ia.post(`/cases/${c.id}/assign`, { userId: callerId }, { ifMatch: hot.version }));
  return { id: c.id, caseNo: c.caseNo, version: s2.version, stage: s2.stage };
}

/** Completes an EPC visit so the meeting gate opens, then advances to S3. */
export async function leadAtS3(eu: ApiClient, ia: ApiClient, ic: ApiClient, callerId: string, epcPartnerId: string, overrides: Record<string, unknown> = {}) {
  const c = await leadAtS2(eu, ia, callerId, overrides);
  const appt = expectOk<{ id: string }>(await ic.post(`/cases/${c.id}/appointments`, { meetingType: "EPC_VISIT", scheduledAt: new Date(Date.now() - 3600_000).toISOString(), bookingRemarks: "site survey", epcPartnerId }), 201);
  expectOk(await ic.patch(`/appointments/${appt.id}`, { action: "COMPLETE", actualAt: new Date().toISOString(), meetingRemarks: "Roof is fine, 3 kW load" }));
  const cur = expectOk<{ version: number }>(await ic.get(`/cases/${c.id}`));
  const s3 = expectOk<{ id: string; version: number; stage: string }>(await ic.post(`/cases/${c.id}/advance`, undefined, { ifMatch: cur.version }));
  return { id: c.id, caseNo: c.caseNo, version: s3.version, stage: s3.stage };
}
