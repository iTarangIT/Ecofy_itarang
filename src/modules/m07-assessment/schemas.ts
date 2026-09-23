import { z } from "zod";

export const ApplianceLine = z.object({ applianceName: z.string().min(1), watts: z.number().int().min(1), quantity: z.number().int().min(1) });
export const CalcInput = z.object({
  segment: z.enum(["RESI", "ESS", "CI"]),
  productInterest: z.enum(["SOLAR_STORAGE", "STORAGE_ONLY", "SOLAR_ONLY", "NOT_SURE"]).optional(),
  method: z.enum(["APPLIANCES", "MONTHLY_UNITS", "RUNNING_LOAD", "NONE"]),
  appliances: z.array(ApplianceLine).optional(),
  monthlyUnits: z.number().min(0).optional(),
  runningLoadKw: z.number().min(0).optional(),
  sanctionedLoadKw: z.number().min(0).optional(),
  backupHours: z.number().min(0).max(24).optional(),
  phase: z.enum(["SINGLE", "THREE"]),
});
export const AssessmentCreate = z.object({
  method: z.enum(["CALCULATOR", "MANUAL", "EPC"]),
  calculator: CalcInput.optional(),
  manual: z.object({ batteryKwh: z.number().min(0).optional(), inverterKva: z.number().min(0).optional(), solarKwp: z.number().min(0).optional(), sourceNote: z.string().min(3) }).optional(),
  selectedSystemCode: z.string().optional(),
  overrideReason: z.string().min(3).optional(),
});
export type CalcInputT = z.infer<typeof CalcInput>;
export type AssessmentCreateT = z.infer<typeof AssessmentCreate>;
