/**
 * In-memory sliding-window limiter for per-process protections (device code resend, login attempts).
 * Business limits that must survive restarts (OTP sends per offer per hour) are counted in the database.
 */
const buckets = new Map<string, number[]>();

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  const since = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > since);
  if (hits.length >= max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    buckets.set(key, hits);
    return { allowed: false, retryAfterSeconds };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
