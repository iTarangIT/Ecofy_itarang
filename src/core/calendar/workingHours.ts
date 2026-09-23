/**
 * Working-hours ageing (BRD FR-02.3, FR-05.1, FR-17.2; UAT-07).
 * All arithmetic is done in the tenant's local calendar (IST) using the `working_hours`
 * rows (ISO weekday 1..7, start/end time) and the `holidays` list. No SLA targets exist.
 */
export type WorkingDay = { weekday: number; start: string; end: string }; // "10:00", "19:00"
export type Calendar = { workingHours: WorkingDay[]; holidays: string[]; timeZone?: string }; // holidays: "YYYY-MM-DD"

const DEFAULT_TZ = "Asia/Kolkata";

type Local = { y: number; m: number; d: number; hh: number; mm: number; ss: number; weekday: number; dateKey: string };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false, weekday: "short",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    fmtCache.set(tz, f);
  }
  return f;
}
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function toLocal(date: Date, tz = DEFAULT_TZ): Local {
  const parts = Object.fromEntries(fmt(tz).formatToParts(date).map((p) => [p.type, p.value]));
  const hh = Number(parts.hour) % 24; // Intl may yield "24" for midnight in some engines
  const y = Number(parts.year), m = Number(parts.month), d = Number(parts.day);
  return { y, m, d, hh, mm: Number(parts.minute), ss: Number(parts.second), weekday: WD[parts.weekday] ?? 0, dateKey: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` };
}

function parseTime(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** Seconds since local midnight. */
function secondsOfDay(l: Local) {
  return l.hh * 3600 + l.mm * 60 + l.ss;
}

/**
 * Working hours (decimal) elapsed between `from` and `to`.
 * Walks day by day in the tenant time zone; each day contributes the overlap between
 * [from,to] and that day's working window, unless the day is a holiday or has no window.
 */
export function workingHoursBetween(from: Date, to: Date, cal: Calendar): number {
  if (to <= from) return 0;
  const tz = cal.timeZone ?? DEFAULT_TZ;
  const windows = new Map<number, { start: number; end: number }>();
  for (const w of cal.workingHours) windows.set(w.weekday, { start: parseTime(w.start) * 60, end: parseTime(w.end) * 60 });
  const holidays = new Set(cal.holidays);

  let total = 0;
  // iterate in 24h steps anchored on local dates; use local date keys to detect day changes
  let cursor = new Date(from.getTime());
  const end = to.getTime();
  // Safety cap ~ 5 years
  for (let i = 0; i < 2000 && cursor.getTime() < end; i++) {
    const l = toLocal(cursor, tz);
    const win = windows.get(l.weekday);
    const dayStartSec = secondsOfDay(l);
    // seconds from cursor to next local midnight
    const toMidnight = 86400 - dayStartSec;
    const segmentEndMs = Math.min(end, cursor.getTime() + toMidnight * 1000);
    if (win && !holidays.has(l.dateKey)) {
      const segStart = dayStartSec;
      const segEnd = dayStartSec + (segmentEndMs - cursor.getTime()) / 1000;
      const overlap = Math.max(0, Math.min(segEnd, win.end) - Math.max(segStart, win.start));
      total += overlap;
    }
    cursor = new Date(segmentEndMs);
  }
  return total / 3600;
}

/** Ageing band label from the configured working-day boundaries (e.g. [1,3,7] → "0-1","1-3","3-7","7+"). */
export function ageingBand(workingHours: number, bandsWorkingDays: number[], hoursPerDay = 9): string {
  const days = workingHours / hoursPerDay;
  const sorted = [...bandsWorkingDays].sort((a, b) => a - b);
  let prev = 0;
  for (const b of sorted) {
    if (days < b) return `${prev}-${b}`;
    prev = b;
  }
  return `${prev}+`;
}

export const DEFAULT_CALENDAR: Calendar = {
  workingHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "10:00", end: "19:00" })),
  holidays: [],
  timeZone: DEFAULT_TZ,
};
