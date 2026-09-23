import { NextResponse, type NextRequest } from "next/server";
import { route } from "@/core/http/route";
import { ok, toResponse } from "@/core/http/envelope";
import { errors } from "@/core/http/errors";
import { resolveTenant, normaliseHost } from "@/core/auth/tenant";
import { readCookies, sessionCookies, newDeviceCookie } from "@/core/auth/cookies";
import { requestIdFrom, clientIp } from "@/core/http/requestId";
import { registerSession } from "@/modules/m01-access/service";
import { SessionRegister } from "@/modules/m01-access/schemas";

/**
 * POST /auth/session — called right after Supabase signInWithPassword. The tokens arrive in the body
 * (additive to the OpenAPI `{}`), are verified, and become httpOnly host-only cookies. The device
 * cookie is issued here when missing (FR-01.2). Public: the caller is not yet a registered session.
 */
export const POST = route({ roles: "public", body: SessionRegister }, async ({ req, body }) => {
  const requestId = requestIdFrom(req.headers);
  const tenantId = await resolveTenant(normaliseHost(req.headers.get("host")));
  if (!tenantId) throw errors.notFound("Tenant");
  const cookies = readCookies(req as NextRequest);
  const accessToken = body.accessToken ?? cookies.access;
  if (!accessToken) throw errors.unauthenticated("accessToken is required");
  const fresh = cookies.device ? null : newDeviceCookie();
  const deviceValue = cookies.device ?? fresh!.value;
  const state = await registerSession({ tenantId, accessToken, deviceCookie: deviceValue, ip: clientIp(req.headers), userAgent: req.headers.get("user-agent"), requestId, now: new Date() });
  const res = toResponse(ok(state), requestId);
  const nres = new NextResponse(res.body, res);
  for (const c of sessionCookies(accessToken, body.refreshToken ?? cookies.refresh ?? "")) nres.cookies.set(c);
  if (fresh) nres.cookies.set(fresh);
  return { raw: nres };
});
