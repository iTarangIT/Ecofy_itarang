import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@/core/db/client";
import { withDbContext, setContext } from "@/core/db/tx";
import { AppError, errors, fromPgError, isAppError } from "@/core/http/errors";
import type { RequestContext } from "@/core/http/context";
import { assign, closeCase, requireCase } from "@/modules/m04-qualify/service";
import { returnToEcofy } from "@/modules/m05-queue/service";
import { logActivity } from "@/modules/m06-followup/service";
import { ActivityCreate } from "@/modules/m06-followup/schemas";
import { SYSTEM } from "./outbound";

/**
 * iTarang CRM → Ecofy (docs/CONFLICTS.md #24, contract in docs/ITARANG_CRM_SYNC.md).
 * Each event runs the same module service an iTarang Admin would call, as the configured integration
 * user (ITARANG_CRM_ACTOR_EMAIL), so gates, RLS, audit and outbox apply unchanged. The CRM user's name
 * is carried into the reason / note. Event ids are recorded in `integration_inbox`: a retried event
 * returns the first answer and is never applied twice.
 */
const base = {
  eventId: z.string().min(1).max(200),
  occurredAt: z.string().datetime({ offset: true }),
  ecofyCaseId: z.string().uuid(),
  crmLeadId: z.string().min(1).max(200),
  actorName: z.string().min(1).max(200),
};

export const CrmInboundEvent = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("lead.accepted"), data: z.object({}).optional() }),
  z.object({ ...base, type: z.literal("lead.assigned"), data: z.object({ assigneeName: z.string().min(1).max(200), reason: z.string().max(500).optional() }) }),
  z.object({ ...base, type: z.literal("lead.activity"), data: ActivityCreate }),
  z.object({ ...base, type: z.literal("lead.returned"), data: z.object({ reasonCode: z.string().min(1), note: z.string().max(2000).optional() }) }),
  z.object({ ...base, type: z.literal("lead.closed"), data: z.object({ closureReason: z.string().min(1), note: z.string().max(2000).optional() }) }),
]);
export type CrmInboundEventT = z.infer<typeof CrmInboundEvent>;

export type InboundReply = { status: number; body: Record<string, unknown>; duplicate: boolean };

class Duplicate extends Error {}

function errorBody(err: AppError, requestId: string) {
  return { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}), ...(err.gate ? { gate: err.gate } : {}), requestId } };
}

async function actorFor(tx: RequestContext["tx"], tenantId: string, email: string) {
  const u = (await tx.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, email))).limit(1))[0];
  if (!u || u.status !== "ACTIVE" || u.role !== "ITARANG_ADMIN") throw errors.internal("ITARANG_CRM_ACTOR_EMAIL must name an ACTIVE iTarang Admin of this tenant");
  return u;
}

async function linkCase(ctx: RequestContext, caseId: string, crmLeadId: string) {
  const l = schema.integrationLinks;
  const cur = (await ctx.tx.select().from(l).where(and(eq(l.tenantId, ctx.auth.tenantId), eq(l.system, SYSTEM), eq(l.caseId, caseId))).limit(1))[0];
  if (cur && cur.externalId !== crmLeadId) throw errors.validation(`Case is linked to CRM lead ${cur.externalId}`, { crmLeadId: cur.externalId });
  if (cur) return;
  // the CRM acts only on leads Ecofy handed over
  const d = schema.integrationDeliveries;
  const pushed = await ctx.tx.select({ id: d.id }).from(d).where(and(eq(d.tenantId, ctx.auth.tenantId), eq(d.system, SYSTEM), eq(d.caseId, caseId), eq(d.eventType, "lead.pushed"))).limit(1);
  if (!pushed[0]) throw errors.gate("crm_lead", "This case was never sent to the iTarang CRM");
  await ctx.tx.insert(l).values({ tenantId: ctx.auth.tenantId, system: SYSTEM, caseId, externalId: crmLeadId, linkedAt: ctx.now });
}

async function apply(ctx: RequestContext, e: CrmInboundEventT) {
  const c = await requireCase(ctx, e.ecofyCaseId);
  await linkCase(ctx, c.id, e.crmLeadId);
  const by = `iTarang CRM · ${e.actorName}`;
  switch (e.type) {
    case "lead.accepted":
      return;
    case "lead.assigned": {
      const reason = `${by}: assigned to ${e.data.assigneeName}${e.data.reason ? ` (${e.data.reason})` : ""}`;
      // S1 → S2 needs an Ecofy assignee: the integration user holds the case; the CRM names the person
      if (c.stage === "S1") await assign(ctx, c.id, null, { userId: ctx.auth.userId, reason });
      else await logActivity(ctx, c.id, { type: "REMARK", note: reason });
      return;
    }
    case "lead.activity":
      await logActivity(ctx, c.id, { ...e.data, note: `[${by}] ${e.data.note ?? ""}`.trim() });
      return;
    case "lead.returned":
      await returnToEcofy(ctx, c.id, null, { reasonCode: e.data.reasonCode, note: [by, e.data.note].filter(Boolean).join(": ") });
      return;
    case "lead.closed":
      await closeCase(ctx, c.id, null, { closureReason: e.data.closureReason, note: [by, e.data.note].filter(Boolean).join(": ") });
      return;
  }
}

export async function receiveEvent(tenantId: string, actorEmail: string, e: CrmInboundEventT, meta: { requestId: string; ip: string | null; userAgent: string | null; now?: Date }): Promise<InboundReply> {
  const now = meta.now ?? new Date();
  const inbox = schema.integrationInbox;
  const stored = async (tx: RequestContext["tx"]) =>
    (await tx.select().from(inbox).where(and(eq(inbox.tenantId, tenantId), eq(inbox.system, SYSTEM), eq(inbox.eventId, e.eventId))).limit(1))[0];
  const replay = (r: typeof inbox.$inferSelect): InboundReply => ({ status: r.httpStatus, body: r.result as Record<string, unknown>, duplicate: true });
  const record = (tx: RequestContext["tx"], status: "APPLIED" | "REJECTED", httpStatus: number, result: Record<string, unknown>) =>
    tx.insert(inbox).values({ tenantId, system: SYSTEM, eventId: e.eventId, eventType: e.type, caseId: e.ecofyCaseId, status, httpStatus, result, receivedAt: now }).onConflictDoNothing().returning({ eventId: inbox.eventId });

  const run = <T>(fn: (ctx: RequestContext) => Promise<T>) =>
    withDbContext({ tenantId, userId: null, role: "ITARANG_ADMIN" }, async (tx) => {
      const u = await actorFor(tx, tenantId, actorEmail);
      const ctx: RequestContext = {
        requestId: meta.requestId, ip: meta.ip, userAgent: meta.userAgent, tx, now,
        auth: { tenantId, userId: u.id, role: "ITARANG_ADMIN", org: "ITARANG", orgId: u.orgId, email: u.email, fullName: u.fullName, sessionId: "itarang-crm" },
      };
      // re-scope the transaction to the integration user (audit actor, RLS app_user())
      await setContext(tx, { tenantId, userId: u.id, role: "ITARANG_ADMIN" });
      return fn(ctx);
    });

  try {
    return await run(async (ctx) => {
      const prev = await stored(ctx.tx);
      if (prev) return replay(prev);
      await apply(ctx, e);
      const c = await requireCase(ctx, e.ecofyCaseId);
      const body = { data: { eventId: e.eventId, status: "APPLIED", case: { ecofyCaseId: c.id, caseNo: c.caseNo, stage: c.stage, version: c.version } } };
      if (!(await record(ctx.tx, "APPLIED", 200, body)).length) throw new Duplicate(); // raced with the same event id
      return { status: 200, body, duplicate: false };
    });
  } catch (err) {
    if (err instanceof Duplicate) return run(async (ctx) => replay((await stored(ctx.tx))!));
    const appErr = isAppError(err) ? err : fromPgError(err);
    if (!appErr || appErr.status >= 500) throw err; // transient: not recorded, the CRM retries
    const body = errorBody(appErr, meta.requestId);
    return run(async (ctx) => {
      const prev = await stored(ctx.tx);
      if (prev) return replay(prev);
      await record(ctx.tx, "REJECTED", appErr.status, body);
      return { status: appErr.status, body, duplicate: false };
    });
  }
}
