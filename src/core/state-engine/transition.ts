import { and, eq, sql, isNull } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { errors } from "@/core/http/errors";
import { actorOf, tenantOf, type ActorContext } from "@/core/http/context";

export type Stage = "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8" | "CLOSED";
export type CaseRow = typeof schema.cases.$inferSelect;

export const STAGE_ORDER: Stage[] = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"];

/** Sub-statuses named in BRD §4.2. */
export const SUB_STATUS = {
  S4: ["ELIGIBILITY_PENDING", "QUOTE_PENDING", "OFFER_READY"],
  S5: ["OTP_SENT"],
  S6: ["AWAITING_DECISION", "REACCEPTANCE_PENDING", "REJECTED_ROUTING"],
  S7: ["INSTALLING", "INSTALLED"],
} as const;

export type Gate = {
  /** Name reported in GATE_NOT_MET */
  name: string;
  /** Returns a failure message, or null when the gate is satisfied. */
  check: (c: CaseRow) => Promise<string | null> | string | null;
};

export type TransitionInput = {
  caseId: string;
  /** If-Match value; null for platform-driven changes (import reopen, jobs). */
  expectedVersion: number | null;
  to: Stage;
  subStatus?: string | null;
  reason?: string | null;
  gates?: Gate[];
  /** Extra column updates applied in the same UPDATE (e.g. temperature, queue_entered_at, closure fields). */
  set?: Partial<typeof schema.cases.$inferInsert>;
  /** Optional predicate on the current stage; violated → GATE_NOT_MET("stage"). */
  from?: Stage | Stage[];
  auditAction?: string;
  eventType?: "case.stage_changed" | "case.closed" | "case.reopened" | "case.pushed" | "case.temperature_set" | "case.returned" | "case.assigned";
  eventPayload?: Record<string, unknown>;
};

/**
 * Loads the case with a row lock (RLS-scoped, so out-of-scope = NOT_FOUND) and checks If-Match.
 * Shared by every case-changing endpoint, including those that do not change the stage.
 */
export async function lockCase(ctx: ActorContext, caseId: string, expectedVersion: number | null): Promise<CaseRow> {
  const rows = await ctx.tx.select().from(schema.cases).where(and(eq(schema.cases.id, caseId), eq(schema.cases.tenantId, tenantOf(ctx)))).for("update");
  const c = rows[0];
  if (!c) throw errors.notFound("Case");
  if (expectedVersion !== null && c.version !== expectedVersion) throw errors.versionConflict(expectedVersion, c.version);
  return c;
}

/**
 * The only path that changes `cases.stage` / `sub_status` (BRD §3.2, §4.2).
 * Gate failure → GATE_NOT_MET naming the gate. Writes stage history, audit and outbox in the same transaction.
 */
export async function transition(ctx: ActorContext, input: TransitionInput): Promise<CaseRow> {
  const c = await lockCase(ctx, input.caseId, input.expectedVersion);
  if (input.from) {
    const allowed = Array.isArray(input.from) ? input.from : [input.from];
    if (!allowed.includes(c.stage as Stage)) throw errors.gate("stage", `Case is at ${c.stage}; expected ${allowed.join(" or ")}`);
  }
  for (const g of input.gates ?? []) {
    const msg = await g.check(c);
    if (msg) throw errors.gate(g.name, msg);
  }
  const actor = actorOf(ctx);
  const closing = input.to === "CLOSED";
  const updated = await ctx.tx
    .update(schema.cases)
    .set({
      stage: input.to,
      subStatus: input.subStatus ?? null,
      stageEnteredAt: ctx.now,
      version: sql`${schema.cases.version} + 1`,
      updatedAt: ctx.now,
      ...(closing ? { closedAt: ctx.now } : {}),
      ...(input.set ?? {}),
    })
    .where(eq(schema.cases.id, c.id))
    .returning();
  const next = updated[0];
  if (!next) throw errors.notFound("Case");
  if (closing) await ctx.tx.update(schema.caseAssignments).set({ endedAt: ctx.now }).where(and(eq(schema.caseAssignments.caseId, c.id), isNull(schema.caseAssignments.endedAt)));

  await ctx.tx.insert(schema.caseStageHistory).values({
    tenantId: c.tenantId,
    caseId: c.id,
    fromStage: c.stage,
    toStage: input.to,
    subStatus: input.subStatus ?? null,
    reason: input.reason ?? null,
    actorId: actor.id,
    at: ctx.now,
  });
  await audit(ctx, {
    action: input.auditAction ?? "case.stage_changed",
    entityType: "case",
    entityId: c.id,
    caseId: c.id,
    before: { stage: c.stage, subStatus: c.subStatus, version: c.version },
    after: { stage: next.stage, subStatus: next.subStatus, version: next.version },
    reason: input.reason ?? null,
  });
  await emit(ctx, "case.stage_changed", c.id, { caseNo: c.caseNo, from: c.stage, to: input.to, subStatus: input.subStatus ?? null, ...(input.eventPayload ?? {}) });
  if (input.eventType && input.eventType !== "case.stage_changed") await emit(ctx, input.eventType, c.id, { caseNo: c.caseNo, ...(input.eventPayload ?? {}) });
  return next;
}

/** Sub-status change without a stage change (e.g. S4 ELIGIBILITY_PENDING → QUOTE_PENDING). Bumps version. */
export async function setSubStatus(ctx: ActorContext, caseId: string, expectedVersion: number | null, subStatus: string | null, reason?: string | null): Promise<CaseRow> {
  const c = await lockCase(ctx, caseId, expectedVersion);
  if (c.subStatus === subStatus) return c;
  const updated = await ctx.tx
    .update(schema.cases)
    .set({ subStatus, version: sql`${schema.cases.version} + 1`, updatedAt: ctx.now })
    .where(eq(schema.cases.id, c.id))
    .returning();
  await ctx.tx.insert(schema.caseStageHistory).values({ tenantId: c.tenantId, caseId: c.id, fromStage: c.stage, toStage: c.stage, subStatus, reason: reason ?? null, actorId: actorOf(ctx).id, at: ctx.now });
  await audit(ctx, { action: "case.sub_status", entityType: "case", entityId: c.id, caseId: c.id, before: { subStatus: c.subStatus }, after: { subStatus }, reason });
  return updated[0];
}

/**
 * Non-stage changes on a case (assignment, temperature, financier, first call...): applies `set`,
 * bumps `version` and `updated_at`, audits. Every If-Match endpoint uses this or `transition`.
 */
export async function touchCase(ctx: ActorContext, caseId: string, expectedVersion: number | null, set: Partial<typeof schema.cases.$inferInsert>, auditInput: { action: string; before?: unknown; after?: unknown; reason?: string | null; bump?: boolean }): Promise<CaseRow> {
  const c = await lockCase(ctx, caseId, expectedVersion);
  const bump = auditInput.bump !== false;
  const updated = await ctx.tx
    .update(schema.cases)
    .set({ ...set, ...(bump ? { version: sql`${schema.cases.version} + 1` } : {}), updatedAt: ctx.now })
    .where(eq(schema.cases.id, c.id))
    .returning();
  await audit(ctx, { action: auditInput.action, entityType: "case", entityId: c.id, caseId: c.id, before: auditInput.before, after: auditInput.after, reason: auditInput.reason ?? null });
  return updated[0];
}
