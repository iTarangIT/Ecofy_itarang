import { and, eq, asc } from "drizzle-orm";
import { schema, type Tx } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import type { ReleaseParams, Appliance, StandardSystem } from "@/modules/m07-assessment/calculator/engine";

export type ReleaseRow = typeof schema.calcReleases.$inferSelect;

/** Loads a release with its appliances and standard systems in engine shape. */
export async function loadReleaseBundle(tx: Tx, tenantId: string, releaseId: string) {
  const rel = (await tx.select().from(schema.calcReleases).where(and(eq(schema.calcReleases.tenantId, tenantId), eq(schema.calcReleases.id, releaseId))).limit(1))[0];
  if (!rel) throw errors.notFound("Calculator release");
  const appliances = (await tx.select().from(schema.calcAppliances).where(eq(schema.calcAppliances.releaseId, rel.id)).orderBy(asc(schema.calcAppliances.sortOrder))).map(applianceOut);
  const systems = (await tx.select().from(schema.calcSystems).where(eq(schema.calcSystems.releaseId, rel.id)).orderBy(asc(schema.calcSystems.systemCode))).map(systemOut);
  return { release: rel, params: rel.params as ReleaseParams, appliances, systems };
}

export async function publishedRelease(tx: Tx, tenantId: string): Promise<ReleaseRow | null> {
  const r = await tx.select().from(schema.calcReleases).where(and(eq(schema.calcReleases.tenantId, tenantId), eq(schema.calcReleases.status, "PUBLISHED"))).limit(1);
  return r[0] ?? null;
}

export function applianceOut(a: typeof schema.calcAppliances.$inferSelect): Appliance & { id: string; sortOrder: number } {
  return { id: a.id, name: a.name, defaultWatts: a.defaultWatts, isMotor: a.isMotor, startMultiplier: Number(a.startMultiplier), sortOrder: a.sortOrder, active: a.active };
}

export function systemOut(s: typeof schema.calcSystems.$inferSelect): StandardSystem & { id: string; inverterType: string; batteryChemistry: string | null; expandable: boolean | null; maxExpansionKwh: number | null; priceUpdatedOn: string; epcPartners: string | null; notes: string | null } {
  return {
    id: s.id, systemCode: s.systemCode, systemName: s.systemName, forResi: s.forResi, forEss: s.forEss, forCi: s.forCi,
    systemType: s.systemType as StandardSystem["systemType"], batteryCapacityKwh: Number(s.batteryCapacityKwh), usableCapacityKwh: Number(s.usableCapacityKwh),
    batteryChemistry: s.batteryChemistry, inverterKva: Number(s.inverterKva), inverterType: s.inverterType, phase: s.phase as StandardSystem["phase"], solarKwp: Number(s.solarKwp),
    expandable: s.expandable, maxExpansionKwh: s.maxExpansionKwh === null ? null : Number(s.maxExpansionKwh), batteryWarrantyYears: s.batteryWarrantyYears, inverterWarrantyYears: s.inverterWarrantyYears,
    equipmentPriceMinInr: s.equipmentPriceMinInr, equipmentPriceMaxInr: s.equipmentPriceMaxInr, installationPriceMinInr: s.installationPriceMinInr, installationPriceMaxInr: s.installationPriceMaxInr,
    gstPct: Number(s.gstPct), priceUpdatedOn: String(s.priceUpdatedOn), epcPartners: s.epcPartners, active: s.active, notes: s.notes,
  };
}
