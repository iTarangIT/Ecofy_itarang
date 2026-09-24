import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/core/config";
import { resolveTenant, normaliseHost } from "@/core/auth/tenant";
import { errors } from "@/core/http/errors";
import { toErrorResponse } from "@/core/http/envelope";
import { requestIdFrom, clientIp } from "@/core/http/requestId";
import { verify, SIGNATURE_HEADER } from "@/core/auth/hmac";
import { receiveEvent } from "@/modules/m18-crm-sync/inbound";
import { CrmInboundEvent } from "@/modules/m18-crm-sync/schemas";

/**
 * POST /integrations/itarang/events — events from the iTarang CRM (docs/ITARANG_CRM_SYNC.md).
 * Not in the OpenAPI (docs/CONFLICTS.md #24). Machine-to-machine: no user session; the body must carry
 * a valid X-Itarang-Signature (HMAC with ITARANG_CRM_SECRET). Tenant comes from the Host header.
 */
export async function POST(req: NextRequest) {
  const requestId = requestIdFrom(req.headers);
  try {
    const { ITARANG_CRM_SECRET: secret, ITARANG_CRM_ACTOR_EMAIL: actorEmail } = config();
    if (!secret || !actorEmail) throw errors.notFound("Integration");
    const raw = await req.text();
    if (!verify(secret, req.headers.get(SIGNATURE_HEADER), raw)) throw errors.unauthenticated("Bad or expired X-Itarang-Signature");
    const tenantId = await resolveTenant(normaliseHost(req.headers.get("host")));
    if (!tenantId) throw errors.notFound("Tenant");
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw errors.validation("Body is not JSON"); }
    const parsed = CrmInboundEvent.safeParse(json);
    if (!parsed.success) throw errors.validation("Invalid event", { issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    const r = await receiveEvent(tenantId, actorEmail, parsed.data, { requestId, ip: clientIp(req.headers), userAgent: req.headers.get("user-agent") });
    return NextResponse.json(r.body, { status: r.status, headers: { "X-Request-Id": requestId, ...(r.duplicate ? { "X-Itarang-Duplicate": "true" } : {}) } });
  } catch (e) {
    return toErrorResponse(e, requestId);
  }
}
