import { z } from "zod";

export const Assign = z.object({ userId: z.string().uuid(), reason: z.string().max(500).optional() });
export const BulkAssign = z.object({ caseIds: z.array(z.string().uuid()).min(1).max(500), userId: z.string().uuid(), reason: z.string().max(500).optional() });
export const TemperatureSet = z.object({ temperature: z.enum(["COLD", "WARM", "HOT", "NOT_INTERESTED"]), note: z.string().max(1000).optional(), closureReason: z.string().optional() });
export const Close = z.object({ closureReason: z.string().min(1), note: z.string().max(1000).optional() });
export const Return = z.object({ reasonCode: z.string().min(1), note: z.string().max(1000).optional() });
export const CaseListQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  stage: z.string().optional(),
  temperature: z.string().optional(),
  userId: z.string().uuid().optional(),
  segment: z.enum(["RESI", "ESS", "CI"]).optional(),
  q: z.string().max(100).optional(),
  unassigned: z.enum(["true", "false"]).optional(),
  overdue: z.enum(["true", "false"]).optional(),
  owner: z.enum(["ECOFY", "ITARANG"]).optional(),
  subStatus: z.string().optional(),
});
export type CaseListQueryT = z.infer<typeof CaseListQuery>;
