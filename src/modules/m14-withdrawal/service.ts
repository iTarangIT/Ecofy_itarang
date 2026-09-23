import { and, eq, desc } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { transition, lockCase, touchCase } from "@/core/state-engine/transition";
import type { RequestContext } from "@/core/http/context";
import { requireCase } from "@/modules/m04-qualify/service";
import { caseOut } from "@/modules/m04-qualify/caseView";

export type WithdrawalRow = typeof schema.withdrawals.$inferSelect;

export function withdrawalOut(w: WithdrawalRow) {
  return { id: w.id, caseId: w.caseId, stageAtRequest: w.stageAtRequest, reason: w.reason, status: w.status, requestedBy: w.requestedBy, requestedAt: w.requestedAt, confirmedBy: w.confirmedBy, confirmedAt: w.confirmedAt, ecofyAlertedAt: w.ecofyAlertedAt, sanctionCancelledAt: w.sanctionCancelledAt, epcInformedAt: w.epcInformedAt };
}

export async function listWithdrawals(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const rows = await ctx.tx.select().from(schema.withdrawals).where(eq(schema.withdrawals.caseId, c.id)).orderBy(desc(schema.withdrawals.requestedAt));
  return rows.map(withdrawalOut);
}

/**
 * FR-14.1 / FR-14.2 (UAT-28): before acceptance (S0–S4) the withdrawal closes the case at once (WITHDRAWN);
 * after acceptance (S5+) it is REQUESTED until iTarang Admin confirms, and Ecofy is alerted to stop.
 */
export async function requestWithdrawal(ctx: RequestContext, caseId: string, reason: string) {
  const c = await lockCase(ctx, caseId, null);
  if (c.stage === "CLOSED") throw errors.gate("stage", "Case is already closed");
  if (c.stage === "S8") throw errors.gate("stage", "After disbursement this is not a withdrawal; Ecofy handles it outside the platform (FR-14.5)");
  const before = ["S0", "S1", "S2", "S3", "S4"].includes(c.stage);
  const row = (await ctx.tx.insert(schema.withdrawals).values({ tenantId: c.tenantId, caseId: c.id, stageAtRequest: c.stage, reason, status: before ? "CONFIRMED" : "REQUESTED", requestedBy: ctx.auth.userId, requestedAt: ctx.now, ...(before ? { confirmedBy: ctx.auth.userId, confirmedAt: ctx.now } : {}) }).returning())[0];
  await audit(ctx, { action: "withdrawal.request", entityType: "withdrawal", entityId: row.id, caseId: c.id, after: { stageAtRequest: c.stage, immediate: before }, reason });
  if (before) {
    await transition(ctx, { caseId: c.id, expectedVersion: null, to: "CLOSED", set: { closureReason: "WITHDRAWN", closureNote: reason }, reason: "WITHDRAWN", auditAction: "case.close", eventType: "case.closed", eventPayload: { closureReason: "WITHDRAWN" } });
    await emit(ctx, "withdrawal.confirmed", row.id, { caseId: c.id, immediate: true });
  } else {
    await touchCase(ctx, c.id, null, {}, { action: "withdrawal.requested", after: { withdrawalId: row.id }, bump: false });
    await emit(ctx, "withdrawal.requested", row.id, { caseId: c.id, notify: [{ role: "ITARANG_ADMIN", type: "withdrawal.requested", title: `${c.caseNo}: withdrawal requested at ${c.stage} — confirm or reject`, body: reason, caseId: c.id }] });
  }
  return withdrawalOut((await ctx.tx.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, row.id)).limit(1))[0]);
}

async function loadWithdrawal(ctx: RequestContext, id: string) {
  const w = (await ctx.tx.select().from(schema.withdrawals).where(and(eq(schema.withdrawals.tenantId, ctx.auth.tenantId), eq(schema.withdrawals.id, id))).limit(1))[0];
  if (!w) throw errors.notFound("Withdrawal");
  await requireCase(ctx, w.caseId);
  return w;
}

/** FR-14.2: IA confirms; the case closes (the File is kept); EA is alerted to stop. FR-14.4: an installation in progress is STOPPED. */
export async function confirmWithdrawal(ctx: RequestContext, id: string) {
  const w = await loadWithdrawal(ctx, id);
  if (w.status !== "REQUESTED") throw errors.validation(`Withdrawal is ${w.status}`);
  const c = await lockCase(ctx, w.caseId, null);
  await ctx.tx.update(schema.withdrawals).set({ status: "CONFIRMED", confirmedBy: ctx.auth.userId, confirmedAt: ctx.now, ecofyAlertedAt: ctx.now }).where(eq(schema.withdrawals.id, w.id));
  const inst = (await ctx.tx.select().from(schema.installations).where(eq(schema.installations.caseId, c.id)).limit(1))[0];
  if (inst && ["SCHEDULED", "IN_PROGRESS"].includes(inst.status)) {
    await ctx.tx.update(schema.installations).set({ status: "STOPPED", stopReason: `Customer withdrew: ${w.reason}`, updatedBy: ctx.auth.userId, updatedAt: ctx.now }).where(eq(schema.installations.id, inst.id));
    await ctx.tx.insert(schema.installationEvents).values({ tenantId: c.tenantId, installationId: inst.id, status: "STOPPED", note: `Customer withdrew: ${w.reason}`, actorId: ctx.auth.userId, at: ctx.now });
  }
  const next = await transition(ctx, { caseId: c.id, expectedVersion: null, to: "CLOSED", set: { closureReason: "WITHDRAWN", closureNote: w.reason }, reason: "WITHDRAWN", auditAction: "withdrawal.confirm", eventType: "case.closed", eventPayload: { closureReason: "WITHDRAWN", withdrawalId: w.id } });
  await audit(ctx, { action: "withdrawal.confirm", entityType: "withdrawal", entityId: w.id, caseId: c.id });
  await emit(ctx, "withdrawal.confirmed", w.id, { caseId: c.id, notify: [{ role: "ECOFY_ADMIN", type: "withdrawal.confirmed", title: `${c.caseNo}: customer withdrew after acceptance — stop financing; mark the sanction cancelled`, body: w.reason, caseId: c.id }] });
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}

export async function rejectWithdrawal(ctx: RequestContext, id: string, reason: string) {
  const w = await loadWithdrawal(ctx, id);
  if (w.status !== "REQUESTED") throw errors.validation(`Withdrawal is ${w.status}`);
  await ctx.tx.update(schema.withdrawals).set({ status: "REJECTED", confirmedBy: ctx.auth.userId, confirmedAt: ctx.now }).where(eq(schema.withdrawals.id, w.id));
  await audit(ctx, { action: "withdrawal.reject", entityType: "withdrawal", entityId: w.id, caseId: w.caseId, reason });
  await touchCase(ctx, w.caseId, null, {}, { action: "withdrawal.rejected", after: { withdrawalId: w.id }, reason, bump: false });
}

/** FR-14.3: after sanction, EA marks the sanction cancelled; IA marks the EPC informed. */
export async function markSanctionCancelled(ctx: RequestContext, id: string) {
  const w = await loadWithdrawal(ctx, id);
  if (w.status !== "CONFIRMED") throw errors.validation("Withdrawal is not confirmed");
  await ctx.tx.update(schema.withdrawals).set({ sanctionCancelledAt: ctx.now }).where(eq(schema.withdrawals.id, w.id));
  await ctx.tx.update(schema.financingDecisions).set({ status: "CANCELLED", decidedAt: ctx.now, recordedBy: ctx.auth.userId }).where(and(eq(schema.financingDecisions.caseId, w.caseId), eq(schema.financingDecisions.status, "SANCTIONED")));
  await audit(ctx, { action: "withdrawal.sanction_cancelled", entityType: "withdrawal", entityId: w.id, caseId: w.caseId });
  return withdrawalOut((await ctx.tx.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, w.id)).limit(1))[0]);
}

export async function markEpcInformed(ctx: RequestContext, id: string) {
  const w = await loadWithdrawal(ctx, id);
  if (w.status !== "CONFIRMED") throw errors.validation("Withdrawal is not confirmed");
  await ctx.tx.update(schema.withdrawals).set({ epcInformedAt: ctx.now }).where(eq(schema.withdrawals.id, w.id));
  await audit(ctx, { action: "withdrawal.epc_informed", entityType: "withdrawal", entityId: w.id, caseId: w.caseId });
  return withdrawalOut((await ctx.tx.select().from(schema.withdrawals).where(eq(schema.withdrawals.id, w.id)).limit(1))[0]);
}
