import { z } from "zod";

export const SettingPatch = z.object({ value: z.unknown(), reason: z.string().max(500).optional() });
export const ListItemCreate = z.object({ code: z.string().regex(/^[A-Z0-9_]{2,40}$/), label: z.string().min(1).max(80), sortOrder: z.number().int().optional() });
export const ListItemPatch = z.object({ label: z.string().min(1).max(80).optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional() });
export const CalendarPut = z.object({
  workingHours: z.array(z.object({ weekday: z.number().int().min(1).max(7), start: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/), end: z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/) })),
  holidays: z.array(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().min(1) })),
});
export const EpcPartnerIn = z.object({
  name: z.string().min(2),
  contactName: z.string().optional(),
  mobile: z.string().regex(/^[6-9][0-9]{9}$/).optional(),
  email: z.string().email().optional(),
  pincodes: z.array(z.string().regex(/^[1-9][0-9]{5}$/)),
  segments: z.array(z.enum(["RESI", "ESS", "CI"])),
  active: z.boolean().optional(),
});
export const EpcPartnerPatch = EpcPartnerIn.partial();
export const FinancierIn = z.object({ name: z.string().min(2), valuesVisibleTo: z.enum(["ECOFY_ADMIN", "ITARANG_ADMIN"]), active: z.boolean().optional() });
export const FinancierPatch = FinancierIn.partial();

export const LIST_CODES = ["return_reason", "closure_reason", "meeting_type", "document_type", "language", "consent_source", "property_type", "product_interest", "existing_backup", "call_time"] as const;
export type ListCode = (typeof LIST_CODES)[number];
