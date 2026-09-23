import { NextResponse, type NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { config } from "@/core/config";
import { schema } from "@/core/db/client";
import { withSystemContext } from "@/core/db/tx";
import { resolveTenant, normaliseHost } from "@/core/auth/tenant";

/**
 * POST /webhooks/sms/delivery — Gupshup delivery reports. The OpenAPI defines no auth; this build requires
 * X-Webhook-Secret = SMS_WEBHOOK_SECRET (recorded in docs/CONFLICTS.md). Body: { externalId | providerMsgId, status }.
 */
export async function POST(req: NextRequest) {
  const given = req.headers.get("x-webhook-secret") ?? "";
  const expected = config().SMS_WEBHOOK_SECRET;
  if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "bad secret" } }, { status: 401 });
  const tenantId = await resolveTenant(normaliseHost(req.headers.get("host")));
  if (!tenantId) return NextResponse.json({ error: { code: "NOT_FOUND", message: "tenant" } }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { externalId?: string; providerMsgId?: string; status?: string; eventType?: string };
  const id = body.providerMsgId ?? body.externalId;
  const st = (body.status ?? body.eventType ?? "").toUpperCase();
  if (!id) return NextResponse.json({ ok: true, ignored: true });
  const status = st.includes("DELIVER") ? "DELIVERED" : st.includes("FAIL") || st.includes("UNDELIV") ? "FAILED" : null;
  if (!status) return NextResponse.json({ ok: true, ignored: true });
  await withSystemContext(tenantId, async (tx) => {
    await tx.update(schema.smsMessages).set({ status, ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}) }).where(and(eq(schema.smsMessages.tenantId, tenantId), eq(schema.smsMessages.providerMsgId, id)));
  });
  return NextResponse.json({ ok: true });
}
