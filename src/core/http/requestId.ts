import { randomUUID } from "node:crypto";

export function requestIdFrom(headers: Headers): string {
  const given = headers.get("x-request-id");
  if (given && /^[A-Za-z0-9._-]{8,64}$/.test(given)) return given;
  return randomUUID();
}

export function clientIp(headers: Headers): string | null {
  const xf = headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return headers.get("x-real-ip");
}
