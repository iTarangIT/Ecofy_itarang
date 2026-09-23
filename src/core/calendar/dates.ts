const IST = "Asia/Kolkata";

/** YYYY-MM-DD of the instant in IST (the business calendar). */
export function istDate(d: Date): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(d); // en-CA yields YYYY-MM-DD
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = Date.UTC(...(fromYmd.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
  const b = Date.UTC(...(toYmd.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : v)) as [number, number, number]);
  return Math.round((b - a) / 86400_000);
}

/** Parse DD-MM-YYYY (template dates) → YYYY-MM-DD or null. */
export function parseDdMmYyyy(s: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  if (d.getUTCFullYear() !== Number(yyyy) || d.getUTCMonth() !== Number(mm) - 1 || d.getUTCDate() !== Number(dd)) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export function minutesAgo(d: Date, minutes: number): Date {
  return new Date(d.getTime() - minutes * 60_000);
}
export function hoursAgo(d: Date, hours: number): Date {
  return new Date(d.getTime() - hours * 3600_000);
}
export function daysAgo(d: Date, days: number): Date {
  return new Date(d.getTime() - days * 86400_000);
}
