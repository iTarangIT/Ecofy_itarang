import { and, eq, desc, exists, inArray, or, sql } from "drizzle-orm";
import { schema, type Tx } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { getSetting } from "@/core/settings/settingsCache";
import { transition, lockCase, setSubStatus, touchCase, type CaseRow } from "@/core/state-engine/transition";
import { encodeCursor, decodeCursor } from "@/core/http/serialize";
import type { RequestContext } from "@/core/http/context";
import type { Role } from "@/core/auth/rbac";
import { requireCase } from "@/modules/m04-qualify/service";
import { caseOut } from "@/modules/m04-qualify/caseView";
import { financierById } from "@/modules/m02-settings/service";
import { issueOtp } from "@/modules/m10-acceptance/service";
import type { FinancingDecisionT } from "./schemas";

export type DecisionRow = typeof schema.financingDecisions.$inferSelect;

/** Financing decision without amounts; values (RLS-guarded) are attached only for the role named on the row. */
export async function decisionOut(tx: Tx, d: DecisionRow, role: Role) {
  const fin = (await tx.select({ name: schema.financiers.name, visibleTo: schema.financiers.valuesVisibleTo }).from(schema.financiers).where(eq(schema.financiers.id, d.financierId)).limit(1))[0];
  const base = { id: d.id, caseId: d.caseId, fileId: d.fileId, financierId: d.financierId, financierName: fin?.name ?? null, attemptNo: d.attemptNo, status: d.status, rejectionReason: d.rejectionReason, routedBy: d.routedBy, recordedBy: d.recordedBy, submittedAt: d.submittedAt, decidedAt: d.decidedAt };
  if (fin?.visibleTo !== role) return base;
  const v = (await tx.select().from(schema.financingValues).where(eq(schema.financingValues.decisionId, d.id)).limit(1))[0]; // RLS: only the named role can read it anyway
  return v ? { ...base, values: { sanctionedInr: v.sanctionedInr, downPaymentInr: v.downPaymentInr, tenureMonths: v.tenureMonths, emiInr: v.emiInr, lenderFileNo: v.lenderFileNo, recordedAt: v.recordedAt } } : base;
}

export async function openDecision(tx: Tx, caseId: string): Promise<DecisionRow | null> {
  const r = await tx.select().from(schema.financingDecisions).where(and(eq(schema.financingDecisions.caseId, caseId), eq(schema.financingDecisions.status, "SUBMITTED"))).limit(1);
  return r[0] ?? null;
}

export async function latestSanction(tx: Tx, caseId: string): Promise<DecisionRow | null> {
  const r = await tx.select().from(schema.financingDecisions).where(and(eq(schema.financingDecisions.caseId, caseId), eq(schema.financingDecisions.status, "SANCTIONED"))).orderBy(desc(schema.financingDecisions.attemptNo)).limit(1);
  return r[0] ?? null;
}

export async function listDecisions(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const rows = await ctx.tx.select().from(schema.financingDecisions).where(eq(schema.financingDecisions.caseId, c.id)).orderBy(schema.financingDecisions.attemptNo);
  return Promise.all(rows.map((d) => decisionOut(ctx.tx, d, ctx.auth.role)));
}

/**
 * FR-11.1: Files awaiting a decision for the financiers whose values this role may see.
 * CONFLICTS #27: also the financier's SANCTIONED Files whose case is still REACCEPTANCE_PENDING at S6, so the
 * queue keeps showing a File until financing is actually settled (`waitingOn` tells the two apart).
 */
export async function financingQueue(ctx: RequestContext, q: { cursor?: string; limit?: number }) {
  const limit = q.limit ?? 50;
  const fins = await ctx.tx.select({ id: schema.financiers.id }).from(schema.financiers).where(and(eq(schema.financiers.tenantId, ctx.auth.tenantId), eq(schema.financiers.valuesVisibleTo, ctx.auth.role)));
  if (!fins.length) return { data: [], meta: { nextCursor: null, limit } };
  const cur = decodeCursor<{ at: string; id: string }>(q.cursor);
  const reacceptancePending = exists(ctx.tx.select({ one: sql`1` }).from(schema.cases).where(and(eq(schema.cases.id, schema.financingDecisions.caseId), eq(schema.cases.stage, "S6"), eq(schema.cases.subStatus, "REACCEPTANCE_PENDING"))));
  const conds = [
    eq(schema.financingDecisions.tenantId, ctx.auth.tenantId),
    inArray(schema.financingDecisions.financierId, fins.map((f) => f.id)),
    or(eq(schema.financingDecisions.status, "SUBMITTED"), and(eq(schema.financingDecisions.status, "SANCTIONED"), reacceptancePending))!,
  ];
  if (cur) conds.push(sql`(${schema.financingDecisions.submittedAt}, ${schema.financingDecisions.id}) > (${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const decisions = await ctx.tx.select().from(schema.financingDecisions).where(and(...conds)).orderBy(schema.financingDecisions.submittedAt, schema.financingDecisions.id).limit(limit + 1);
  const page = decisions.slice(0, limit);
  const cases = page.length ? await ctx.tx.select().from(schema.cases).where(inArray(schema.cases.id, page.map((d) => d.caseId))) : [];
  const files = page.length ? await ctx.tx.select().from(schema.files).where(inArray(schema.files.id, page.map((d) => d.fileId))) : [];
  const out = await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, cases, { list: true, now: ctx.now });
  const byCase = new Map(out.map((c) => [c.id, c]));
  const byFile = new Map(files.map((f) => [f.id, f]));
  const data = page.map((d) => {
    const f = byFile.get(d.fileId);
    return { ...byCase.get(d.caseId), waitingOn: d.status === "SUBMITTED" ? ("DECISION" as const) : ("REACCEPTANCE" as const), decision: { id: d.id, attemptNo: d.attemptNo, status: d.status, submittedAt: d.submittedAt, decidedAt: d.decidedAt }, file: f ? { id: f.id, fileNo: f.fileNo, acceptedTotalInr: f.acceptedTotalInr, quoteVersion: f.quoteVersion, acceptedAt: f.acceptedAt } : null };
  }).filter((x) => x.id);
  const last = page[page.length - 1];
  return { data, meta: { nextCursor: decisions.length > limit && last ? encodeCursor({ at: last.submittedAt.toISOString(), id: last.id }) : null, limit } };
}

/**
 * FR-11.2 … FR-11.4: record Sanctioned (values → financing_values, role-guarded) or Rejected (reason).
 * Sanctioned below the accepted total → REACCEPTANCE_PENDING (the case stays at S6). Otherwise S6 → S7.
 */
export async function recordDecision(ctx: RequestContext, caseId: string, ifMatch: number | null, input: FinancingDecisionT) {
  const c = await lockCase(ctx, caseId, ifMatch);
  if (c.stage !== "S6") throw errors.gate("stage", `Financing decisions are recorded at S6 (case is at ${c.stage})`);
  const d = await openDecision(ctx.tx, c.id);
  if (!d) throw errors.gate("decision_open", "No financing attempt is awaiting a decision");
  const fin = await financierById(ctx.tx, c.tenantId, d.financierId);
  if (fin.valuesVisibleTo !== ctx.auth.role) throw errors.forbidden(`Only ${fin.valuesVisibleTo} records decisions for ${fin.name}`);
  const file = (await ctx.tx.select().from(schema.files).where(eq(schema.files.id, d.fileId)).limit(1))[0];
  if (!file) throw errors.internal("File missing");
  let next: CaseRow;
  if (input.status === "SANCTIONED") {
    if (!input.values) throw errors.validation("values.sanctionedInr is required for SANCTIONED");
    await ctx.tx.update(schema.financingDecisions).set({ status: "SANCTIONED", recordedBy: ctx.auth.userId, decidedAt: ctx.now }).where(eq(schema.financingDecisions.id, d.id));
    await ctx.tx.insert(schema.financingValues).values({ decisionId: d.id, tenantId: c.tenantId, visibleTo: ctx.auth.role, sanctionedInr: input.values.sanctionedInr, downPaymentInr: input.values.downPaymentInr ?? null, tenureMonths: input.values.tenureMonths ?? null, emiInr: input.values.emiInr ?? null, lenderFileNo: input.values.lenderFileNo ?? null, recordedBy: ctx.auth.userId, recordedAt: ctx.now });
    const lower = input.values.sanctionedInr < file.acceptedTotalInr;
    await audit(ctx, { action: "financing.sanction", entityType: "financing_decision", entityId: d.id, caseId: c.id, after: { attemptNo: d.attemptNo, sanctionedInr: input.values.sanctionedInr, belowAccepted: lower } });
    if (lower) {
      next = await setSubStatus(ctx, c.id, c.version, "REACCEPTANCE_PENDING", "Sanctioned below the accepted total");
    } else {
      next = await transition(ctx, { caseId: c.id, expectedVersion: c.version, to: "S7", subStatus: "INSTALLING", reason: `Sanction recorded (attempt ${d.attemptNo})`, auditAction: "financing.decided" });
    }
    await emit(ctx, "financing.decided", d.id, {
      caseId: c.id, status: "SANCTIONED", belowAccepted: lower,
      notify: [...(c.assignedUserId ? [{ userId: c.assignedUserId, type: "financing.decided", title: `${c.caseNo}: sanction recorded${lower ? " — re-acceptance pending" : ""}`, caseId: c.id }] : []), { role: "ITARANG_ADMIN", type: "financing.decided", title: `${c.caseNo}: sanction recorded by ${fin.name}`, caseId: c.id }],
    });
  } else {
    if (!input.rejectionReason) throw errors.validation("rejectionReason is required for REJECTED");
    await ctx.tx.update(schema.financingDecisions).set({ status: "REJECTED", rejectionReason: input.rejectionReason, recordedBy: ctx.auth.userId, decidedAt: ctx.now }).where(eq(schema.financingDecisions.id, d.id));
    await audit(ctx, { action: "financing.reject", entityType: "financing_decision", entityId: d.id, caseId: c.id, after: { attemptNo: d.attemptNo }, reason: input.rejectionReason });
    next = await setSubStatus(ctx, c.id, c.version, "REJECTED_ROUTING", input.rejectionReason);
    await emit(ctx, "financing.decided", d.id, { caseId: c.id, status: "REJECTED", notify: [{ role: "ITARANG_ADMIN", type: "financing.rejected", title: `${c.caseNo}: rejected by ${fin.name} — route to the next financier or close`, body: input.rejectionReason, caseId: c.id }, ...(c.assignedUserId ? [{ userId: c.assignedUserId, type: "financing.rejected", title: `${c.caseNo}: financing rejected`, caseId: c.id }] : [])] });
  }
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}

/**
 * FR-10.6 / FR-11.3: Ecofy Admin triggers the re-acceptance OTP. The SMS text is built inside EA's transaction
 * from financing_values; the amounts are never written to the offer, so the caller sees status only.
 */
export async function triggerReacceptance(ctx: RequestContext, caseId: string, decisionId: string, idempotencyKey: string) {
  const c = await lockCase(ctx, caseId, null);
  if (c.stage !== "S6" || c.subStatus !== "REACCEPTANCE_PENDING") throw errors.gate("reacceptance_pending", "Re-acceptance applies only while the case is REACCEPTANCE_PENDING at S6");
  const d = (await ctx.tx.select().from(schema.financingDecisions).where(and(eq(schema.financingDecisions.id, decisionId), eq(schema.financingDecisions.caseId, c.id))).limit(1))[0];
  if (!d || d.status !== "SANCTIONED") throw errors.validation("decisionId must be the SANCTIONED decision of this case");
  const fin = await financierById(ctx.tx, c.tenantId, d.financierId);
  if (fin.valuesVisibleTo !== ctx.auth.role) throw errors.forbidden("Only the financier's role can trigger re-acceptance");
  const v = (await ctx.tx.select().from(schema.financingValues).where(eq(schema.financingValues.decisionId, d.id)).limit(1))[0];
  if (!v?.sanctionedInr) throw errors.internal("financing values missing");
  const offer = (await ctx.tx.select().from(schema.offers).where(and(eq(schema.offers.caseId, c.id), eq(schema.offers.status, "ACCEPTED"))).orderBy(desc(schema.offers.version)).limit(1))[0];
  if (!offer) throw errors.internal("accepted offer missing");
  const dlt = (await getSetting(c.tenantId, "sms.dlt_template_reacceptance", ctx.tx)) ?? "DLT-REACCEPTANCE-DEV";
  const dp = v.downPaymentInr ?? 0;
  const { row, settings, code } = await issueOtp(ctx, c, offer, "REACCEPTANCE", idempotencyKey, (code, min) => `Your financed amount is Rs ${v.sanctionedInr!.toLocaleString("en-IN")} and down payment Rs ${dp.toLocaleString("en-IN")}. OTP to accept the revised terms: ${code} (valid ${min} min). - Ecofy`, String(dlt));
  await audit(ctx, { action: "reacceptance.trigger", entityType: "financing_decision", entityId: d.id, caseId: c.id });
  await emit(ctx, "reacceptance.triggered", d.id, { caseId: c.id, notify: c.assignedUserId ? [{ userId: c.assignedUserId, type: "reacceptance.triggered", title: `${c.caseNo}: re-acceptance OTP sent to the customer`, caseId: c.id }] : [] });
  await touchCase(ctx, c.id, null, {}, { action: "reacceptance.triggered", after: { challengeId: row.id }, bump: false });
  const { otpOut } = await import("@/modules/m10-acceptance/service");
  return otpOut(row, settings.maxAttempts, settings.resendAfter, code);
}

/**
 * FR-09.10 / FR-11.4: iTarang Admin routes to the next financier from S4 (not eligible) or S6 (rejected).
 * Ecofy loses sight of the case through RLS once it is neither lead source nor current financier.
 */
export async function routeFinancier(ctx: RequestContext, caseId: string, ifMatch: number | null, input: { financierId: string; note: string }) {
  const c = await lockCase(ctx, caseId, ifMatch);
  const fin = await financierById(ctx.tx, c.tenantId, input.financierId);
  if (!fin.active) throw errors.validation("Financier is inactive");
  if (fin.id === c.financierId) throw errors.validation("The case is already with this financier");
  let next: CaseRow;
  if (c.stage === "S4") {
    const last = (await ctx.tx.select().from(schema.eligibilityChecks).where(and(eq(schema.eligibilityChecks.caseId, c.id), eq(schema.eligibilityChecks.financierId, c.financierId ?? ""))).orderBy(desc(schema.eligibilityChecks.requestedAt)).limit(1))[0];
    if (!last || last.status !== "NOT_ELIGIBLE") throw errors.gate("not_eligible", "Routing from S4 needs a NOT_ELIGIBLE decision from the current financier");
    next = await touchCase(ctx, c.id, c.version, { financierId: fin.id, subStatus: "ELIGIBILITY_PENDING" }, { action: "financier.route", before: { financierId: c.financierId }, after: { financierId: fin.id }, reason: input.note });
    const check = (await ctx.tx.insert(schema.eligibilityChecks).values({ tenantId: c.tenantId, caseId: c.id, financierId: fin.id, status: "REQUESTED", requestedBy: ctx.auth.userId, requestedAt: ctx.now }).returning())[0];
    await emit(ctx, "eligibility.requested", check.id, { caseId: c.id, financierId: fin.id, notify: [{ role: fin.valuesVisibleTo as Role, type: "eligibility.requested", title: `${c.caseNo} routed to ${fin.name}: eligibility awaited`, caseId: c.id }] });
  } else if (c.stage === "S6") {
    const open = await openDecision(ctx.tx, c.id);
    if (open) throw errors.gate("decision_open", "A financing decision is still awaited; record it before routing");
    const lastRejected = (await ctx.tx.select().from(schema.financingDecisions).where(and(eq(schema.financingDecisions.caseId, c.id), eq(schema.financingDecisions.status, "REJECTED"))).orderBy(desc(schema.financingDecisions.attemptNo)).limit(1))[0];
    if (!lastRejected) throw errors.gate("rejected", "Routing from S6 needs a REJECTED decision");
    const attempts = (await ctx.tx.select({ n: sql<number>`coalesce(max(attempt_no), 0)::int` }).from(schema.financingDecisions).where(eq(schema.financingDecisions.caseId, c.id)))[0]?.n ?? 0;
    await ctx.tx.insert(schema.financingDecisions).values({ tenantId: c.tenantId, caseId: c.id, fileId: lastRejected.fileId, financierId: fin.id, attemptNo: Number(attempts) + 1, status: "SUBMITTED", routedBy: ctx.auth.userId, submittedAt: ctx.now });
    next = await touchCase(ctx, c.id, c.version, { financierId: fin.id, subStatus: "AWAITING_DECISION" }, { action: "financier.route", before: { financierId: c.financierId }, after: { financierId: fin.id, attemptNo: Number(attempts) + 1 }, reason: input.note });
    await ctx.tx.insert(schema.caseStageHistory).values({ tenantId: c.tenantId, caseId: c.id, fromStage: "S6", toStage: "S6", subStatus: "AWAITING_DECISION", reason: `Routed to ${fin.name}: ${input.note}`, actorId: ctx.auth.userId, at: ctx.now });
    await emit(ctx, "file.locked", lastRejected.fileId, { caseId: c.id, routed: true, notify: [{ role: fin.valuesVisibleTo as Role, type: "financing.routed", title: `${c.caseNo} routed to ${fin.name}: decision awaited`, caseId: c.id }] });
  } else {
    throw errors.gate("stage", "Routing applies at S4 (not eligible) or S6 (rejected)");
  }
  await emit(ctx, "financier.routed", c.id, { caseId: c.id, financierId: fin.id, note: input.note });
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}
