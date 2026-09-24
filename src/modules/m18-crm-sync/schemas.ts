import { z } from "zod";
import { ActivityCreate } from "@/modules/m06-followup/schemas";

/** Events the iTarang CRM posts to POST /integrations/itarang/events (docs/ITARANG_CRM_SYNC.md §4). */
const base = {
  eventId: z.string().min(1).max(200),
  occurredAt: z.string().datetime({ offset: true }),
  ecofyCaseId: z.string().uuid(),
  crmLeadId: z.string().min(1).max(200),
  actorName: z.string().min(1).max(200),
};

export const CrmInboundEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("lead.accepted"), data: z.object({}).optional() }),
  z.object({ ...base, type: z.literal("lead.assigned"), data: z.object({ assigneeName: z.string().min(1).max(200), reason: z.string().max(500).optional() }) }),
  z.object({ ...base, type: z.literal("lead.activity"), data: ActivityCreate }),
  z.object({ ...base, type: z.literal("lead.returned"), data: z.object({ reasonCode: z.string().min(1), note: z.string().max(2000).optional() }) }),
  z.object({ ...base, type: z.literal("lead.closed"), data: z.object({ closureReason: z.string().min(1), note: z.string().max(2000).optional() }) }),
]);
export type CrmInboundEventT = z.infer<typeof CrmInboundEvent>;
