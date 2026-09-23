import { randomBytes, createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { config } from "@/core/config";

export type CookieSpec = { name: string; value: string; maxAge: number; httpOnly?: boolean };

function base(): Omit<ResponseCookieInit, "name" | "value"> {
  return { httpOnly: true, secure: config().cookieSecure, sameSite: "lax", path: "/" }; // host-only: no Domain attribute
}

type ResponseCookieInit = {
  name: string; value: string; httpOnly?: boolean; secure?: boolean; sameSite?: "lax" | "strict" | "none"; path?: string; maxAge?: number; expires?: Date;
};

export function sessionCookies(accessToken: string, refreshToken: string, accessMaxAge = 60 * 60 * 24 * 7): ResponseCookieInit[] {
  const c = config();
  return [
    { ...base(), name: c.SESSION_COOKIE_NAME, value: accessToken, maxAge: accessMaxAge },
    { ...base(), name: c.REFRESH_COOKIE_NAME, value: refreshToken, maxAge: 60 * 60 * 24 * 30 },
  ];
}

export function clearedSessionCookies(): ResponseCookieInit[] {
  const c = config();
  return [
    { ...base(), name: c.SESSION_COOKIE_NAME, value: "", maxAge: 0 },
    { ...base(), name: c.REFRESH_COOKIE_NAME, value: "", maxAge: 0 },
  ];
}

/** FR-01.2: random 32-byte device cookie, 1 year, host-only; only its SHA-256 is stored. */
export function newDeviceCookie(): ResponseCookieInit {
  return { ...base(), name: config().DEVICE_COOKIE_NAME, value: randomBytes(32).toString("hex"), maxAge: 60 * 60 * 24 * 365 };
}

export function deviceHash(cookieValue: string): string {
  return createHash("sha256").update(cookieValue).digest("hex");
}

export function readCookies(req: NextRequest) {
  const c = config();
  return {
    access: req.cookies.get(c.SESSION_COOKIE_NAME)?.value ?? null,
    refresh: req.cookies.get(c.REFRESH_COOKIE_NAME)?.value ?? null,
    device: req.cookies.get(c.DEVICE_COOKIE_NAME)?.value ?? null,
  };
}

/** Serialise a cookie for a Set-Cookie header (used where NextResponse.cookies is not available). */
export function serializeCookie(c: ResponseCookieInit): string {
  const parts = [`${c.name}=${encodeURIComponent(c.value)}`, `Path=${c.path ?? "/"}`];
  if (c.maxAge !== undefined) parts.push(`Max-Age=${c.maxAge}`);
  if (c.httpOnly) parts.push("HttpOnly");
  if (c.secure) parts.push("Secure");
  if (c.sameSite) parts.push(`SameSite=${c.sameSite[0].toUpperCase()}${c.sameSite.slice(1)}`);
  return parts.join("; ");
}

export type { ResponseCookieInit };
