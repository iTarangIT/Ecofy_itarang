import { and, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { schema } from "@/core/db/client";
import { config } from "@/core/config";
import { audit } from "@/core/audit/audit";
import { errors } from "@/core/http/errors";
import type { RequestContext } from "@/core/http/context";
import { sign, SIGNATURE_HEADER, EVENT_ID_HEADER } from "@/core/auth/hmac";
import { SYSTEM, MAX_ATTEMPTS, outboundEnabled } from "./outbound";

/** Admin › Integration: configuration health, recent traffic, a signed test ping and re-queueing. Never returns the secret. */
export async function status(ctx: RequestContext) {
  const c = config();
  const tenantId = ctx.auth.tenantId;
  const base = c.APP_BASE_URL.replace(/\/$/, "");
  let actor: { email: string; fullName: string; active: boolean; role: string } | null = null;
  if (c.ITARANG_CRM_ACTOR_EMAIL) {
    const u = (await ctx.tx.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, c.ITARANG_CRM_ACTOR_EMAIL))).limit(1))[0];
    actor = u ? { email: u.email, fullName: u.fullName, active: u.status === "ACTIVE", role: u.role } : { email: c.ITARANG_CRM_ACTOR_EMAIL, fullName: "", active: false, role: "" };
  }
  const d = schema.integrationDeliveries;
  const counts = await ctx.tx
    .select({ status: d.status, n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${d.sentAt})` })
    .from(d).where(and(eq(d.tenantId, tenantId), eq(d.system, SYSTEM))).groupBy(d.status);
  const recent = await ctx.tx.select().from(d).where(and(eq(d.tenantId, tenantId), eq(d.system, SYSTEM))).orderBy(desc(d.id)).limit(15);
  const i = schema.integrationInbox;
  const inbound = await ctx.tx.select().from(i).where(and(eq(i.tenantId, tenantId), eq(i.system, SYSTEM))).orderBy(desc(i.receivedAt)).limit(15);
  const links = (await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(schema.integrationLinks).where(and(eq(schema.integrationLinks.tenantId, tenantId), eq(schema.integrationLinks.system, SYSTEM))))[0]?.n ?? 0;
  const by = (s: string) => counts.find((x) => x.status === s);
  return {
    ecofyApiBase: `${base}/api/v1`,
    ecofyEventsUrl: `${base}/api/v1/integrations/itarang/events`,
    crmUrl: c.ITARANG_CRM_URL ?? null,
    secretConfigured: Boolean(c.ITARANG_CRM_SECRET),
    outboundEnabled: outboundEnabled(),
    inboundEnabled: Boolean(c.ITARANG_CRM_SECRET && c.ITARANG_CRM_ACTOR_EMAIL),
    actor,
    maxAttempts: MAX_ATTEMPTS,
    deliveries: { pending: by("PENDING")?.n ?? 0, sent: by("SENT")?.n ?? 0, dead: by("DEAD")?.n ?? 0, lastSentAt: by("SENT")?.last ?? null },
    linkedLeads: links,
    recentDeliveries: recent.map((r) => {
      const b = r.body as { eventId?: string; lead?: { caseNo?: string } };
      return { id: r.id, eventId: b.eventId ?? null, eventType: r.eventType, caseId: r.caseId, caseNo: b.lead?.caseNo ?? null, status: r.status, attempts: r.attempts, lastStatus: r.lastStatus, lastError: r.lastError, createdAt: r.createdAt, sentAt: r.sentAt, nextAttemptAt: r.nextAttemptAt };
    }),
    recentInbound: inbound.map((r) => ({ eventId: r.eventId, eventType: r.eventType, caseId: r.caseId, status: r.status, httpStatus: r.httpStatus, receivedAt: r.receivedAt, error: r.status === "REJECTED" ? ((r.result as { error?: { message?: string } }).error?.message ?? null) : null })),
  };
}

/** Sends a signed `ping` to ITARANG_CRM_URL (fixed by configuration, never taken from the request). */
export async function sendTest(ctx: RequestContext, fetchImpl: typeof fetch = fetch) {
  const c = config();
  if (!c.ITARANG_CRM_URL || !c.ITARANG_CRM_SECRET) throw errors.gate("crm_configured", "Set ITARANG_CRM_URL and ITARANG_CRM_SECRET first");
  const tenant = (await ctx.tx.select({ code: schema.tenants.code }).from(schema.tenants).where(eq(schema.tenants.id, ctx.auth.tenantId)).limit(1))[0];
  const body = { eventId: `ecofy:${tenant?.code ?? ctx.auth.tenantId}:test:${randomUUID()}`, type: "ping", occurredAt: ctx.now.toISOString(), source: "ECOFY", tenant: tenant?.code ?? null, sentBy: ctx.auth.fullName };
  const raw = JSON.stringify(body);
  const started = Date.now();
  let result: { ok: boolean; status: number | null; ms: number; response: string | null; error: string | null };
  try {
    const res = await fetchImpl(c.ITARANG_CRM_URL, { method: "POST", headers: { "content-type": "application/json", [SIGNATURE_HEADER]: sign(c.ITARANG_CRM_SECRET, raw), [EVENT_ID_HEADER]: body.eventId }, body: raw, signal: AbortSignal.timeout(10_000) });
    result = { ok: res.ok, status: res.status, ms: Date.now() - started, response: (await res.text()).slice(0, 1000), error: null };
  } catch (e) {
    result = { ok: false, status: null, ms: Date.now() - started, response: null, error: String(e).slice(0, 500) };
  }
  await audit(ctx, { action: "integration.test", entityType: "integration", entityId: SYSTEM, after: { eventId: body.eventId, status: result.status, ok: result.ok } });
  return { request: body, ...result };
}

/** Re-queues a DEAD (or waiting) delivery for an immediate send. */
export async function retryDelivery(ctx: RequestContext, id: number) {
  const d = schema.integrationDeliveries;
  const r = (await ctx.tx.select().from(d).where(and(eq(d.tenantId, ctx.auth.tenantId), eq(d.system, SYSTEM), eq(d.id, id))).limit(1))[0];
  if (!r) throw errors.notFound("Delivery");
  if (r.status === "SENT") throw errors.gate("not_sent", "This delivery was already accepted by the CRM");
  await ctx.tx.update(d).set({ status: "PENDING", attempts: 0, nextAttemptAt: ctx.now, lastError: null }).where(eq(d.id, r.id));
  await audit(ctx, { action: "integration.retry", entityType: "integration_delivery", entityId: String(r.id), caseId: r.caseId ?? undefined, before: { status: r.status, attempts: r.attempts }, after: { status: "PENDING", attempts: 0 } });
  return { id: r.id, status: "PENDING" };
}
