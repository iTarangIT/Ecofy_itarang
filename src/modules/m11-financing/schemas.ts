import { z } from "zod";

export const FinancingValues = z.object({
  sanctionedInr: z.number().int().min(1),
  downPaymentInr: z.number().int().min(0).optional(),
  tenureMonths: z.number().int().min(1).max(120).optional(),
  emiInr: z.number().int().min(0).optional(),
  lenderFileNo: z.string().max(100).optional(),
});
export const FinancingDecision = z.object({ status: z.enum(["SANCTIONED", "REJECTED"]), values: FinancingValues.optional(), rejectionReason: z.string().min(3).optional() });
export const Reacceptance = z.object({ decisionId: z.string().uuid() });
export const RouteFinancier = z.object({ financierId: z.string().uuid(), note: z.string().min(3) });
export type FinancingDecisionT = z.infer<typeof FinancingDecision>;
