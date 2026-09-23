import { z } from "zod";

export const EligibilityRequest = z.object({ financierId: z.string().uuid().optional() });
export const EligibilityDecision = z.object({ status: z.enum(["ELIGIBLE", "NOT_ELIGIBLE", "INFO_NEEDED"]), maxEligibleInr: z.number().int().min(1).optional(), reason: z.string().min(3).optional() });
export const QuoteRequestCreate = z.object({ epcPartnerId: z.string().uuid(), channel: z.enum(["EMAIL", "WHATSAPP", "PHONE"]) });
export const QuoteRequestPatch = z.object({ status: z.enum(["RECEIVED", "DECLINED"]) });
export const QuoteCreate = z.object({
  documentId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  epcPartnerId: z.string().uuid(),
  quoteRequestId: z.string().uuid().optional(),
  systemDesc: z.string().min(3),
  batteryKwh: z.number().min(0).optional(),
  inverterKva: z.number().min(0).optional(),
  solarKwp: z.number().min(0).optional(),
  equipmentInr: z.number().int().min(0),
  installationInr: z.number().int().min(0),
  gstInr: z.number().int().min(0),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(1000).optional(),
  provisional: z.boolean().optional(),
  provisionalReason: z.string().min(3).optional(),
});
export const OfferCreate = z.object({ quoteId: z.string().uuid() });
export type QuoteCreateT = z.infer<typeof QuoteCreate>;
