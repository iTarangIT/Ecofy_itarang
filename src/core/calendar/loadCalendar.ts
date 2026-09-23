import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/core/db/client";
import type { Calendar } from "./workingHours";
import { DEFAULT_CALENDAR } from "./workingHours";

const cache = new Map<string, { cal: Calendar; at: number }>();
const TTL_MS = 60_000;

/** Tenant calendar (working_hours + holidays) with a short cache. */
export async function loadCalendar(tx: Tx, tenantId: string): Promise<Calendar> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cal;
  const wh = await tx.select().from(schema.workingHours).where(eq(schema.workingHours.tenantId, tenantId));
  const hol = await tx.select().from(schema.holidays).where(eq(schema.holidays.tenantId, tenantId));
  const cal: Calendar = wh.length
    ? { workingHours: wh.map((w) => ({ weekday: w.weekday, start: String(w.startTime).slice(0, 5), end: String(w.endTime).slice(0, 5) })), holidays: hol.map((h) => String(h.day)), timeZone: "Asia/Kolkata" }
    : { ...DEFAULT_CALENDAR, holidays: hol.map((h) => String(h.day)) };
  cache.set(tenantId, { cal, at: Date.now() });
  return cal;
}

export function invalidateCalendar(tenantId: string) {
  cache.delete(tenantId);
}
