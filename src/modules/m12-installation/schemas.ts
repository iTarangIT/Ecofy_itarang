import { z } from "zod";

export const InstallationCreate = z.object({ epcPartnerId: z.string().uuid(), scheduledOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });
export const InstallationUpdate = z.object({
  status: z.enum(["SCHEDULED", "IN_PROGRESS", "INSTALLED", "COMMISSIONED", "STOPPED"]),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(1000).optional(),
  stopReason: z.string().min(3).optional(),
  acknowledgeNoSanction: z.boolean().optional(),
});
export const DownPayment = z.object({ receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amountInr: z.number().int().min(1), reference: z.string().max(100).optional() });
export const Disbursement = z.object({ disbursedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amountInr: z.number().int().min(1), reference: z.string().max(100).optional() });
