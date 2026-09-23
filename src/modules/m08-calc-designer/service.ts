import { and, eq, desc, max, inArray, isNull } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { storage } from "@/adapters";
import { parseDdMmYyyy } from "@/core/calendar/dates";
import type { RequestContext } from "@/core/http/context";
import { runCalculator, type ReleaseParams, type CalcInput } from "@/modules/m07-assessment/calculator/engine";
import { parseUpload } from "@/modules/m03-intake/parse";
import { loadReleaseBundle, publishedRelease, applianceOut, systemOut, type ReleaseRow } from "./releaseRepo";
import { SEED_RELEASE_PARAMS } from "./seedRelease";
import { verbatim } from "@/core/http/serialize";
import { calcOut } from "@/modules/m07-assessment/service";
import type { SystemInT, ApplianceInT } from "./schemas";

export function releaseOut(r: ReleaseRow) {
  return { id: r.id, version: r.version, status: r.status, params: verbatim(r.params), changeNote: r.changeNote, createdBy: r.createdBy, createdAt: r.createdAt, submittedAt: r.submittedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.decisionNote, publishedAt: r.publishedAt };
}

async function loadRelease(ctx: RequestContext, id: string): Promise<ReleaseRow> {
  const r = (await ctx.tx.select().from(schema.calcReleases).where(and(eq(schema.calcReleases.tenantId, ctx.auth.tenantId), eq(schema.calcReleases.id, id))).limit(1))[0];
  if (!r) throw errors.notFound("Calculator release");
  return r;
}

function assertDraft(r: ReleaseRow) {
  if (r.status !== "DRAFT") throw errors.validation(`Release v${r.version} is ${r.status}; only a DRAFT can be edited`);
}

/** Validates the fixed-formula params object (FR-08.3, FR-08.8): values, segments, rules, display, texts. */
export function validateParams(p: unknown): ReleaseParams {
  const x = p as ReleaseParams;
  const bad = (m: string) => errors.validation(`params: ${m}`);
  if (!x || typeof x !== "object") throw bad("object required");
  if (x.formula !== "FIXED_9_STEP_V1") throw bad("formula must be FIXED_9_STEP_V1 (no free-form formula in V1)");
  const v = x.values ?? ({} as ReleaseParams["values"]);
  for (const k of ["usable_share", "inverter_efficiency", "surge_headroom", "power_factor", "solar_units_per_kwp_per_day", "days_per_month"] as const) {
    if (typeof v[k] !== "number" || !(v[k] > 0)) throw bad(`values.${k} must be a positive number`);
  }
  for (const k of ["usable_share", "inverter_efficiency", "power_factor"] as const) if (v[k] > 1) throw bad(`values.${k} must be ≤ 1`);
  if (v.surge_headroom > 1) throw bad("values.surge_headroom must be ≤ 1 (10% = 0.1)");
  for (const seg of ["RESI", "ESS", "CI"] as const) if (!x.segments?.[seg] || typeof x.segments[seg].enabled !== "boolean") throw bad(`segments.${seg}.enabled required`);
  const r = x.rules;
  if (!r) throw bad("rules required");
  for (const k of ["alternatives_smaller", "alternatives_larger"] as const) if (![0, 1, 2].includes(r[k])) throw bad(`rules.${k} must be 0, 1 or 2`);
  if (typeof r.phase_must_match !== "boolean") throw bad("rules.phase_must_match must be boolean");
  if (!r.match_by_type?.SOLAR_STORAGE || !r.match_by_type.STORAGE_ONLY || !r.match_by_type.SOLAR_ONLY) throw bad("rules.match_by_type must cover all three system types");
  if (!x.texts?.disclaimer || !x.texts.financing_line || !x.texts.custom_required || !x.texts.pending_technical_data || !x.texts.ci_message) throw bad("texts must include disclaimer, financing_line, custom_required, pending_technical_data, ci_message");
  return x;
}

export async function listReleases(ctx: RequestContext) {
  const rows = await ctx.tx.select().from(schema.calcReleases).where(eq(schema.calcReleases.tenantId, ctx.auth.tenantId)).orderBy(desc(schema.calcReleases.version));
  return rows.map(releaseOut);
}

export async function getRelease(ctx: RequestContext, id: string) {
  const b = await loadReleaseBundle(ctx.tx, ctx.auth.tenantId, id);
  return { ...releaseOut(b.release), appliances: b.appliances, systems: b.systems };
}

/** FR-08.1: one draft at a time, created from the published release (or the seed defaults when none). */
export async function createDraft(ctx: RequestContext, input: { fromReleaseId?: string; changeNote: string }) {
  const tenantId = ctx.auth.tenantId;
  const source = input.fromReleaseId ? await loadRelease(ctx, input.fromReleaseId) : await publishedRelease(ctx.tx, tenantId);
  const last = (await ctx.tx.select({ v: max(schema.calcReleases.version) }).from(schema.calcReleases).where(eq(schema.calcReleases.tenantId, tenantId)))[0]?.v ?? 0;
  const params = source ? source.params : SEED_RELEASE_PARAMS;
  const draft = (await ctx.tx.insert(schema.calcReleases).values({ tenantId, version: Number(last) + 1, status: "DRAFT", params: params as object, changeNote: input.changeNote, createdBy: ctx.auth.userId, createdAt: ctx.now }).returning())[0];
  if (source) {
    const b = await loadReleaseBundle(ctx.tx, tenantId, source.id);
    if (b.appliances.length) await ctx.tx.insert(schema.calcAppliances).values(b.appliances.map((a) => ({ tenantId, releaseId: draft.id, name: a.name, defaultWatts: a.defaultWatts, isMotor: a.isMotor, startMultiplier: String(a.startMultiplier), sortOrder: a.sortOrder, active: a.active ?? true })));
    if (b.systems.length) await ctx.tx.insert(schema.calcSystems).values(b.systems.map((s) => systemInsert(tenantId, draft.id, s)));
  }
  await audit(ctx, { action: "calc.draft_created", entityType: "calc_release", entityId: draft.id, after: { version: draft.version, fromReleaseId: source?.id ?? null } });
  return releaseOut(draft);
}

export async function patchDraft(ctx: RequestContext, id: string, input: { params?: Record<string, unknown>; changeNote?: string }) {
  const r = await loadRelease(ctx, id);
  assertDraft(r);
  const set: Partial<typeof schema.calcReleases.$inferInsert> = {};
  if (input.params) set.params = validateParams(input.params) as object;
  if (input.changeNote !== undefined) set.changeNote = input.changeNote;
  const row = (await ctx.tx.update(schema.calcReleases).set(set).where(eq(schema.calcReleases.id, r.id)).returning())[0];
  await audit(ctx, { action: "calc.draft_updated", entityType: "calc_release", entityId: r.id, before: { params: r.params }, after: { params: row.params } });
  return releaseOut(row);
}

export async function putAppliances(ctx: RequestContext, id: string, items: ApplianceInT[]) {
  const r = await loadRelease(ctx, id);
  assertDraft(r);
  const names = new Set<string>();
  for (const a of items) {
    if (names.has(a.name.toLowerCase())) throw errors.validation(`Duplicate appliance '${a.name}'`);
    names.add(a.name.toLowerCase());
  }
  await ctx.tx.delete(schema.calcAppliances).where(eq(schema.calcAppliances.releaseId, r.id));
  if (items.length) await ctx.tx.insert(schema.calcAppliances).values(items.map((a, i) => ({ tenantId: ctx.auth.tenantId, releaseId: r.id, name: a.name, defaultWatts: a.defaultWatts, isMotor: a.isMotor, startMultiplier: String(a.startMultiplier), sortOrder: a.sortOrder ?? i + 1, active: a.active ?? true })));
  await audit(ctx, { action: "calc.appliances_replaced", entityType: "calc_release", entityId: r.id, after: { count: items.length } });
}

function systemInsert(tenantId: string, releaseId: string, s: SystemInT | ReturnType<typeof systemOut>): typeof schema.calcSystems.$inferInsert {
  return {
    tenantId, releaseId, systemCode: s.systemCode, systemName: s.systemName, forResi: s.forResi, forEss: s.forEss, forCi: s.forCi, systemType: s.systemType,
    batteryCapacityKwh: String(s.batteryCapacityKwh), usableCapacityKwh: String(s.usableCapacityKwh), batteryChemistry: s.batteryChemistry ?? null, inverterKva: String(s.inverterKva), inverterType: s.inverterType, phase: s.phase,
    solarKwp: String(s.solarKwp), expandable: s.expandable ?? null, maxExpansionKwh: s.maxExpansionKwh == null ? null : String(s.maxExpansionKwh), batteryWarrantyYears: s.batteryWarrantyYears ?? null, inverterWarrantyYears: s.inverterWarrantyYears ?? null,
    equipmentPriceMinInr: s.equipmentPriceMinInr, equipmentPriceMaxInr: s.equipmentPriceMaxInr, installationPriceMinInr: s.installationPriceMinInr, installationPriceMaxInr: s.installationPriceMaxInr,
    gstPct: String(s.gstPct), priceUpdatedOn: s.priceUpdatedOn, epcPartners: s.epcPartners ?? null, active: s.active, notes: s.notes ?? null,
  };
}

function checkSystem(s: SystemInT): string | null {
  if (s.usableCapacityKwh > s.batteryCapacityKwh) return "usable_capacity_kwh cannot exceed battery_capacity_kwh";
  if (s.equipmentPriceMaxInr < s.equipmentPriceMinInr) return "equipment_price_max_inr cannot be below equipment_price_min_inr";
  if (s.installationPriceMaxInr < s.installationPriceMinInr) return "installation_price_max_inr cannot be below installation_price_min_inr";
  return null;
}

export async function putSystems(ctx: RequestContext, id: string, items: SystemInT[]) {
  const r = await loadRelease(ctx, id);
  assertDraft(r);
  const codes = new Set<string>();
  for (const s of items) {
    if (codes.has(s.systemCode)) throw errors.validation(`Duplicate system_code '${s.systemCode}'`);
    codes.add(s.systemCode);
    const bad = checkSystem(s);
    if (bad) throw errors.validation(`${s.systemCode}: ${bad}`);
  }
  await ctx.tx.delete(schema.calcSystems).where(eq(schema.calcSystems.releaseId, r.id));
  if (items.length) await ctx.tx.insert(schema.calcSystems).values(items.map((s) => systemInsert(ctx.auth.tenantId, r.id, s)));
  await audit(ctx, { action: "calc.systems_replaced", entityType: "calc_release", entityId: r.id, after: { count: items.length } });
}

const YN = (v: string) => (v.trim().toUpperCase() === "Y" ? true : v.trim().toUpperCase() === "N" ? false : null);
const SYSTEM_TYPE: Record<string, SystemInT["systemType"]> = { "solar + storage": "SOLAR_STORAGE", "solar+storage": "SOLAR_STORAGE", solar_storage: "SOLAR_STORAGE", "storage only": "STORAGE_ONLY", storage_only: "STORAGE_ONLY", "solar only": "SOLAR_ONLY", solar_only: "SOLAR_ONLY" };
const INV_TYPE: Record<string, SystemInT["inverterType"]> = { hybrid: "HYBRID", "off-grid": "OFF_GRID", "off grid": "OFF_GRID", off_grid: "OFF_GRID", "on-grid": "ON_GRID", "on grid": "ON_GRID", on_grid: "ON_GRID" };
const PHASE: Record<string, SystemInT["phase"]> = { single: "SINGLE", three: "THREE" };

/** FR-08.2: standard systems template v0.2 → codes; rows failing a rule are rejected with the reason. */
export async function importSystems(ctx: RequestContext, id: string, input: { documentId: string; replaceAll?: boolean }) {
  const r = await loadRelease(ctx, id);
  assertDraft(r);
  const doc = (await ctx.tx.select().from(schema.documents).where(and(eq(schema.documents.tenantId, ctx.auth.tenantId), eq(schema.documents.id, input.documentId), isNull(schema.documents.deletedAt))).limit(1))[0];
  if (!doc) throw errors.notFound("Document");
  const st = await storage();
  const buf = await st.getObject(doc.s3Key);
  const parsed = await parseUpload(buf, doc.fileName, ["Systems"], 5001);
  const accepted: SystemInT[] = [];
  const rejected: Array<{ rowNo: number; code: string; reason: string }> = [];
  parsed.rows.forEach((raw, i) => {
    const rowNo = i + 2;
    const g = (k: string) => (raw[k] ?? "").trim();
    const num = (k: string) => (g(k) === "" ? NaN : Number(g(k).replace(/[,₹\s]/g, "")));
    const reasons: string[] = [];
    const yn = (k: string, req = true) => { const v = YN(g(k)); if (v === null && (req || g(k))) reasons.push(`${k} must be Y or N`); return v ?? false; };
    const sys: SystemInT = {
      systemCode: g("system_code"), systemName: g("system_name"), forResi: yn("for_resi"), forEss: yn("for_ess"), forCi: yn("for_ci"),
      systemType: SYSTEM_TYPE[g("system_type").toLowerCase()] ?? ("" as never), batteryCapacityKwh: num("battery_capacity_kwh"), usableCapacityKwh: num("usable_capacity_kwh"),
      batteryChemistry: g("battery_chemistry") || undefined, inverterKva: num("inverter_kva"), inverterType: INV_TYPE[g("inverter_type").toLowerCase()] ?? ("" as never), phase: PHASE[g("phase").toLowerCase()] ?? ("" as never),
      solarKwp: num("solar_kwp"), expandable: g("expandable") ? YN(g("expandable")) ?? undefined : undefined, maxExpansionKwh: g("max_expansion_kwh") ? num("max_expansion_kwh") : undefined,
      batteryWarrantyYears: g("battery_warranty_years") ? num("battery_warranty_years") : undefined, inverterWarrantyYears: g("inverter_warranty_years") ? num("inverter_warranty_years") : undefined,
      equipmentPriceMinInr: num("equipment_price_min_inr"), equipmentPriceMaxInr: num("equipment_price_max_inr"), installationPriceMinInr: num("installation_price_min_inr"), installationPriceMaxInr: num("installation_price_max_inr"),
      gstPct: num("gst_pct"), priceUpdatedOn: parseDdMmYyyy(g("price_updated_on")) ?? (/^\d{4}-\d{2}-\d{2}$/.test(g("price_updated_on")) ? g("price_updated_on") : ""), epcPartners: g("epc_partners") || undefined, active: yn("active"), notes: g("notes") || undefined,
    };
    if (!sys.systemCode) reasons.push("system_code is required");
    if (!sys.systemName) reasons.push("system_name is required");
    if (!sys.systemType) reasons.push("system_type must be Solar + storage / Storage only / Solar only");
    if (!sys.inverterType) reasons.push("inverter_type must be Hybrid / Off-grid / On-grid");
    if (!sys.phase) reasons.push("phase must be Single / Three");
    for (const k of ["batteryCapacityKwh", "usableCapacityKwh", "inverterKva", "solarKwp", "equipmentPriceMinInr", "equipmentPriceMaxInr", "installationPriceMinInr", "installationPriceMaxInr", "gstPct"] as const) if (!Number.isFinite(sys[k])) reasons.push(`${k} must be a number`);
    if (!(sys.inverterKva > 0)) reasons.push("inverter_kva must be > 0");
    if (!(sys.equipmentPriceMinInr > 0)) reasons.push("equipment_price_min_inr must be > 0");
    if (!sys.priceUpdatedOn) reasons.push("price_updated_on must be DD-MM-YYYY");
    const rule = reasons.length ? null : checkSystem(sys);
    if (rule) reasons.push(rule);
    if (accepted.some((a) => a.systemCode === sys.systemCode)) reasons.push("duplicate system_code in file");
    if (reasons.length) rejected.push({ rowNo, code: sys.systemCode, reason: reasons.join("; ") });
    else accepted.push(sys);
  });
  if (input.replaceAll) await ctx.tx.delete(schema.calcSystems).where(eq(schema.calcSystems.releaseId, r.id));
  else if (accepted.length) await ctx.tx.delete(schema.calcSystems).where(and(eq(schema.calcSystems.releaseId, r.id), inArray(schema.calcSystems.systemCode, accepted.map((a) => a.systemCode))));
  if (accepted.length) await ctx.tx.insert(schema.calcSystems).values(accepted.map((s) => systemInsert(ctx.auth.tenantId, r.id, s)));
  await audit(ctx, { action: "calc.systems_imported", entityType: "calc_release", entityId: r.id, after: { imported: accepted.length, rejected: rejected.length, documentId: doc.id } });
  return { imported: accepted.length, rejected };
}

/** FR-08.4 test bench: any input against any release (draft or published), every step shown. */
export async function testBench(ctx: RequestContext, id: string, input: CalcInput) {
  const b = await loadReleaseBundle(ctx.tx, ctx.auth.tenantId, id);
  return calcOut(runCalculator(validateParams(b.params), b.appliances, b.systems, input, b.release.version));
}

export async function submitRelease(ctx: RequestContext, id: string, note?: string) {
  const r = await loadRelease(ctx, id);
  assertDraft(r);
  validateParams(r.params);
  const row = (await ctx.tx.update(schema.calcReleases).set({ status: "PENDING_APPROVAL", submittedAt: ctx.now, changeNote: note ?? r.changeNote }).where(eq(schema.calcReleases.id, r.id)).returning())[0];
  await audit(ctx, { action: "calc.release_submitted", entityType: "calc_release", entityId: r.id, after: { version: r.version } });
  await emit(ctx, "calc.release_submitted", r.id, { version: r.version, notify: [{ role: "ECOFY_ADMIN", type: "calc.release_submitted", title: `Calculator release v${r.version} awaits your approval`, body: note ?? r.changeNote ?? undefined }] });
  return releaseOut(row);
}

/** FR-08.5: Ecofy approves → published, previous published retired. */
export async function approveRelease(ctx: RequestContext, id: string, note?: string) {
  const r = await loadRelease(ctx, id);
  if (r.status !== "PENDING_APPROVAL") throw errors.validation(`Release v${r.version} is ${r.status}; only PENDING_APPROVAL can be approved`);
  const prev = await publishedRelease(ctx.tx, ctx.auth.tenantId);
  if (prev) await ctx.tx.update(schema.calcReleases).set({ status: "RETIRED" }).where(eq(schema.calcReleases.id, prev.id));
  const row = (await ctx.tx.update(schema.calcReleases).set({ status: "PUBLISHED", decidedBy: ctx.auth.userId, decidedAt: ctx.now, decisionNote: note ?? null, publishedAt: ctx.now }).where(eq(schema.calcReleases.id, r.id)).returning())[0];
  await audit(ctx, { action: "calc.release_approved", entityType: "calc_release", entityId: r.id, before: { published: prev?.version ?? null }, after: { published: r.version }, reason: note });
  await emit(ctx, "calc.release_approved", r.id, { version: r.version, notify: [{ role: "ITARANG_ADMIN", type: "calc.release_approved", title: `Calculator release v${r.version} published`, body: note }] });
  return releaseOut(row);
}

export async function rejectRelease(ctx: RequestContext, id: string, note?: string) {
  const r = await loadRelease(ctx, id);
  if (r.status !== "PENDING_APPROVAL") throw errors.validation(`Release v${r.version} is ${r.status}`);
  if (!note) throw errors.validation("note is required on reject");
  const row = (await ctx.tx.update(schema.calcReleases).set({ status: "DRAFT", decidedBy: ctx.auth.userId, decidedAt: ctx.now, decisionNote: note }).where(eq(schema.calcReleases.id, r.id)).returning())[0];
  await audit(ctx, { action: "calc.release_rejected", entityType: "calc_release", entityId: r.id, reason: note });
  await emit(ctx, "calc.release_rejected", r.id, { version: r.version, notify: [{ role: "ITARANG_ADMIN", type: "calc.release_rejected", title: `Calculator release v${r.version} rejected`, body: note }] });
  return releaseOut(row);
}

/** FR-08.6 restore: copy any older release into a new draft. */
export async function restoreRelease(ctx: RequestContext, id: string, changeNote: string) {
  await loadRelease(ctx, id);
  return createDraft(ctx, { fromReleaseId: id, changeNote });
}

export { applianceOut, systemOut };
