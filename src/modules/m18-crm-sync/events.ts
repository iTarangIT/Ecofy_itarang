import type { OutboxEvent } from "@/core/events/types";

/** Pure definitions of the iTarang CRM sync (no database or config imports, so unit tests load them bare). */
export const SYSTEM = "ITARANG_CRM";

export type CrmEventType = "lead.pushed" | "lead.stage_changed";

/** Which Ecofy events the CRM receives. Warm push and Hot both enter the iTarang queue (S0 → S1). */
export function crmEventFor(e: Pick<OutboxEvent, "eventType" | "payload">): CrmEventType | null {
  if (e.eventType === "case.pushed") return "lead.pushed";
  if (e.eventType === "case.temperature_set" && e.payload.temperature === "HOT") return "lead.pushed";
  if (e.eventType === "case.stage_changed") return e.payload.from === "S0" && e.payload.to === "S1" ? null : "lead.stage_changed";
  return null;
}
