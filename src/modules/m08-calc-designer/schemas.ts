import { z } from "zod";

export const ReleaseCreate = z.object({ fromReleaseId: z.string().uuid().optional(), changeNote: z.string().min(3) });
export const ReleasePatch = z.object({ params: z.record(z.string(), z.unknown()).optional(), changeNote: z.string().optional() });
export const ApplianceIn = z.object({ name: z.string().min(2), defaultWatts: z.number().int().min(1), isMotor: z.boolean(), startMultiplier: z.number().min(1).max(8), sortOrder: z.number().int().optional(), active: z.boolean().optional() });
export const AppliancesPut = z.array(ApplianceIn);
export const SystemIn = z.object({
  systemCode: z.string().min(1), systemName: z.string().min(1), forResi: z.boolean(), forEss: z.boolean(), forCi: z.boolean(),
  systemType: z.enum(["SOLAR_STORAGE", "STORAGE_ONLY", "SOLAR_ONLY"]), batteryCapacityKwh: z.number().min(0), usableCapacityKwh: z.number().min(0),
  batteryChemistry: z.string().optional(), inverterKva: z.number().gt(0), inverterType: z.enum(["HYBRID", "OFF_GRID", "ON_GRID"]), phase: z.enum(["SINGLE", "THREE"]),
  solarKwp: z.number().min(0), expandable: z.boolean().optional(), maxExpansionKwh: z.number().min(0).optional(), batteryWarrantyYears: z.number().int().optional(), inverterWarrantyYears: z.number().int().optional(),
  equipmentPriceMinInr: z.number().int().min(1), equipmentPriceMaxInr: z.number().int().min(1), installationPriceMinInr: z.number().int().min(0), installationPriceMaxInr: z.number().int().min(0),
  gstPct: z.number().min(0), priceUpdatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), epcPartners: z.string().optional(), active: z.boolean(), notes: z.string().optional(),
});
export const SystemsPut = z.array(SystemIn);
export const SystemsImport = z.object({ documentId: z.string().uuid(), replaceAll: z.boolean().optional() });
export const ReleaseDecision = z.object({ note: z.string().max(1000).optional() });
export type SystemInT = z.infer<typeof SystemIn>;
export type ApplianceInT = z.infer<typeof ApplianceIn>;
