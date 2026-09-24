import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC request signing between Ecofy and the iTarang CRM (docs/ITARANG_CRM_SYNC.md), Stripe-style:
 *   X-Itarang-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
 * The timestamp is inside the MAC, so a captured request cannot be replayed after `toleranceSec`.
 */
export const SIGNATURE_HEADER = "x-itarang-signature";
export const EVENT_ID_HEADER = "x-itarang-event-id";

export function sign(secret: string, rawBody: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const mac = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${mac}`;
}

export function verify(secret: string, header: string | null, rawBody: string, now: Date = new Date(), toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = new Map(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.get("t"));
  const given = parts.get("v1") ?? "";
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(given)) return false;
  if (Math.abs(now.getTime() / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
}

/**
 * Service calls to the REST API (iTarang CRM acting as an iTarang user, see src/core/auth/service.ts) sign
 * the method and path too, so a captured signature is valid for that one request only:
 *   "<METHOD>\n<path?query>\n<raw body>"   (path as sent, e.g. /api/v1/cases/…/assign)
 */
export function apiSigningString(method: string, pathWithQuery: string, rawBody: string): string {
  return `${method.toUpperCase()}\n${pathWithQuery}\n${rawBody}`;
}
