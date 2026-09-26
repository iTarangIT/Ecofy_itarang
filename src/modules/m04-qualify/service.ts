import { and, eq, sql, desc, isNull, inArray, or, ilike, lt } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { emit } from "@/core/events/outbox";
import { transition, touchCase, lockCase, type CaseRow, type Stage } from "@/core/state-engine/transition";
import { encodeCursor, decodeCursor } from "@/core/http/serialize";
import type { RequestContext } from "@/core/http/context";
import type { Role } from "@/core/auth/rbac";
import { caseOut, loadCase } from "./caseView";
import { assertListCode } from "@/modules/m02-settings/service";
import type { CaseListQueryT } from "./schemas";

const OPEN = sql`${schema.cases.stage} <> 'CLOSED'`;

// ------------------------------------------------------------------ lists (GET /cases) — RLS scopes rows
export async function listCases(ctx: RequestContext, q: CaseListQueryT) {
  const limit = q.limit ?? 50;
  const conds = [eq(schema.cases.tenantId, ctx.auth.tenantId)];
  if (q.stage) conds.push(inArray(schema.cases.stage, q.stage.split(",") as Stage[]));
  if (q.temperature) conds.push(inArray(schema.cases.temperature, q.temperature.split(",") as Array<"COLD" | "WARM" | "HOT" | "NOT_INTERESTED">));
  if (q.userId) conds.push(eq(schema.cases.assignedUserId, q.userId));
  if (q.segment) conds.push(eq(schema.cases.segment, q.segment));
  if (q.subStatus) conds.push(eq(schema.cases.subStatus, q.subStatus));
  if (q.unassigned === "true") conds.push(and(isNull(schema.cases.assignedUserId), OPEN)!);
  if (q.owner) {
    const org = (await ctx.tx.select({ id: schema.orgs.id }).from(schema.orgs).where(and(eq(schema.orgs.tenantId, ctx.auth.tenantId), eq(schema.orgs.kind, q.owner))).limit(1))[0];
    if (org) conds.push(eq(schema.cases.ownerOrgId, org.id));
  }
  if (q.q) {
    const term = `%${q.q.trim()}%`;
    const digits = q.q.replace(/\D/g, "");
    const custIds = await ctx.tx.select({ id: schema.customers.id }).from(schema.customers).where(and(eq(schema.customers.tenantId, ctx.auth.tenantId), or(ilike(schema.customers.fullName, term), digits.length >= 4 ? ilike(schema.customers.mobileE164, `%${digits}%`) : sql`false`, ilike(schema.customers.city, term))!));
    conds.push(or(ilike(schema.cases.caseNo, term), custIds.length ? inArray(schema.cases.customerId, custIds.map((c) => c.id)) : sql`false`)!);
  }
  if (q.overdue === "true") {
    // FR-06.9: next follow-up in the past (latest FOLLOW_UP/CALL activity with next_follow_up_at)
    conds.push(sql`exists (select 1 from activities a where a.case_id = ${schema.cases.id} and a.next_follow_up_at < now()
      and a.id = (select max(id) from activities b where b.case_id = ${schema.cases.id} and b.next_follow_up_at is not null))`);
    conds.push(OPEN);
  }
  const cur = decodeCursor<{ updatedAt: string; id: string }>(q.cursor);
  if (cur) conds.push(sql`(${schema.cases.updatedAt}, ${schema.cases.id}) < (${cur.updatedAt}::timestamptz, ${cur.id}::uuid)`);
  const rows = await ctx.tx.select().from(schema.cases).where(and(...conds)).orderBy(desc(schema.cases.updatedAt), desc(schema.cases.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { data: await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, page, { list: true, now: ctx.now }), meta: { nextCursor: rows.length > limit && last ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id }) : null, limit } };
}

export async function getCase(ctx: RequestContext, caseId: string) {
  const c = await loadCase(ctx.tx, ctx.auth.tenantId, caseId);
  if (!c) throw errors.notFound("Case");
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [c], { now: ctx.now }))[0];
}

export async function requireCase(ctx: RequestContext, caseId: string): Promise<CaseRow> {
  const c = await loadCase(ctx.tx, ctx.auth.tenantId, caseId);
  if (!c) throw errors.notFound("Case");
  return c;
}

/** FR-18.2 timeline: stage history + activities + appointments + documents + decisions (status only) merged by time. */
export async function timeline(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const items: Array<{ at: Date; kind: string; title: string; detail?: unknown; actorId?: string | null }> = [];
  const hist = await ctx.tx.select().from(schema.caseStageHistory).where(eq(schema.caseStageHistory.caseId, c.id));
  for (const h of hist) items.push({ at: h.at, kind: "stage", title: h.fromStage ? `${h.fromStage} → ${h.toStage}${h.subStatus ? ` (${h.subStatus})` : ""}` : `Created at ${h.toStage}`, detail: { reason: h.reason, subStatus: h.subStatus }, actorId: h.actorId });
  const acts = await ctx.tx.select().from(schema.activities).where(eq(schema.activities.caseId, c.id));
  for (const a of acts) items.push({ at: a.at, kind: `activity.${a.type.toLowerCase()}`, title: a.type === "CALL" ? `Call: ${a.callOutcome}` : a.type, detail: { note: a.note, nextFollowUpAt: a.nextFollowUpAt, callOutcome: a.callOutcome }, actorId: a.actorId });
  const appts = await ctx.tx.select().from(schema.appointments).where(eq(schema.appointments.caseId, c.id));
  for (const a of appts) items.push({ at: a.createdAt, kind: "appointment", title: `${a.meetingType} ${a.status} (scheduled ${a.scheduledAt.toISOString()})`, detail: { id: a.id, scheduledAt: a.scheduledAt, actualAt: a.actualAt, bookingRemarks: a.bookingRemarks, meetingRemarks: a.meetingRemarks, outcomeReason: a.outcomeReason, epcFeedback: a.epcFeedback, rescheduledFrom: a.rescheduledFrom }, actorId: a.createdBy });
  const docs = await ctx.tx.select().from(schema.documents).where(and(eq(schema.documents.caseId, c.id), isNull(schema.documents.deletedAt)));
  for (const d of docs) items.push({ at: d.uploadedAt, kind: "document", title: `${d.typeCode}: ${d.fileName}`, detail: { id: d.id, typeCode: d.typeCode, sizeBytes: d.sizeBytes }, actorId: d.uploadedBy });
  const assessments = await ctx.tx.select().from(schema.assessments).where(eq(schema.assessments.caseId, c.id));
  for (const a of assessments) {
    items.push({ at: a.createdAt, kind: "assessment", title: `Assessment v${a.version} (${a.method}) — ${a.recommendationStatus}`, detail: { id: a.id, recommendedCode: a.recommendedCode, selectedCode: a.selectedCode, overrideReason: a.overrideReason }, actorId: a.createdBy });
    if (a.confirmedAt) items.push({ at: a.confirmedAt, kind: "assessment.confirmed", title: `Assessment v${a.version} confirmed`, actorId: a.confirmedBy });
  }
  const elig = await ctx.tx.select().from(schema.eligibilityChecks).where(eq(schema.eligibilityChecks.caseId, c.id));
  for (const e of elig) {
    items.push({ at: e.requestedAt, kind: "eligibility.requested", title: "Sent for eligibility", actorId: e.requestedBy });
    if (e.decidedAt) items.push({ at: e.decidedAt, kind: "eligibility.decided", title: `Eligibility: ${e.status}`, detail: { reason: e.reason }, actorId: e.decidedBy });
  }
  const quotes = await ctx.tx.select().from(schema.quotes).where(eq(schema.quotes.caseId, c.id));
  for (const q of quotes) items.push({ at: q.createdAt, kind: "quote", title: `EPC quote v${q.version} uploaded (${q.status})${q.provisional ? " — Provisional" : ""}`, detail: { id: q.id, totalInr: q.totalInr, validUntil: q.validUntil, provisional: q.provisional, provisionalReason: q.provisionalReason }, actorId: q.uploadedBy });
  const offers = await ctx.tx.select().from(schema.offers).where(eq(schema.offers.caseId, c.id));
  for (const o of offers) {
    items.push({ at: o.createdAt, kind: "offer", title: `Offer v${o.version} composed`, detail: { id: o.id, status: o.status }, actorId: o.createdBy });
    if (o.sentAt) items.push({ at: o.sentAt, kind: "offer.sent", title: `Offer v${o.version} sent (OTP)`, actorId: o.createdBy });
  }
  const files = await ctx.tx.select().from(schema.files).where(eq(schema.files.caseId, c.id));
  for (const f of files) items.push({ at: f.acceptedAt, kind: "file", title: `File ${f.fileNo} locked (quote v${f.quoteVersion})`, detail: { id: f.id, fileNo: f.fileNo, acceptedQuoteId: f.acceptedQuoteId, acceptedTotalInr: f.acceptedTotalInr } });
  const acc = await ctx.tx.select().from(schema.fileAcceptances).where(eq(schema.fileAcceptances.caseId, c.id));
  for (const a of acc) if (a.kind === "REVISED") items.push({ at: a.acceptedAt, kind: "file.reaccepted", title: "Revised acceptance recorded" });
  const fin = await ctx.tx.select().from(schema.financingDecisions).where(eq(schema.financingDecisions.caseId, c.id));
  for (const d of fin) {
    items.push({ at: d.submittedAt, kind: "financing.submitted", title: `Financing attempt ${d.attemptNo} submitted` });
    if (d.decidedAt) items.push({ at: d.decidedAt, kind: "financing.decided", title: `Financing attempt ${d.attemptNo}: ${d.status}`, detail: { rejectionReason: d.rejectionReason }, actorId: d.recordedBy });
  }
  const inst = await ctx.tx.select().from(schema.installations).where(eq(schema.installations.caseId, c.id));
  if (inst[0]) {
    const ev = await ctx.tx.select().from(schema.installationEvents).where(eq(schema.installationEvents.installationId, inst[0].id));
    for (const e of ev) items.push({ at: e.at, kind: "installation", title: `Installation ${e.status}`, detail: { note: e.note }, actorId: e.actorId });
  }
  const wd = await ctx.tx.select().from(schema.withdrawals).where(eq(schema.withdrawals.caseId, c.id));
  for (const w of wd) {
    items.push({ at: w.requestedAt, kind: "withdrawal.requested", title: `Withdrawal requested at ${w.stageAtRequest}`, detail: { reason: w.reason, status: w.status }, actorId: w.requestedBy });
    if (w.confirmedAt) items.push({ at: w.confirmedAt, kind: "withdrawal.confirmed", title: `Withdrawal ${w.status}`, actorId: w.confirmedBy });
  }
  const disb = await ctx.tx.select({ on: schema.disbursements.disbursedOn, at: schema.disbursements.recordedAt }).from(schema.disbursements).where(eq(schema.disbursements.caseId, c.id));
  for (const d of disb) items.push({ at: d.at, kind: "disbursement", title: `Disbursement recorded (${d.on})` });
  const userIds = [...new Set(items.map((i) => i.actorId).filter((x): x is string => Boolean(x)))];
  const users = userIds.length ? await ctx.tx.select({ id: schema.users.id, fullName: schema.users.fullName, role: schema.users.role }).from(schema.users).where(inArray(schema.users.id, userIds)) : [];
  const umap = new Map(users.map((u) => [u.id, u]));
  items.sort((a, b) => a.at.getTime() - b.at.getTime());
  return items.map((i) => ({ ...i, actor: i.actorId ? umap.get(i.actorId) ?? null : { fullName: "Platform", role: null } }));
}

// ------------------------------------------------------------------ assignment (FR-04.1, FR-05.2, FR-05.5)
async function assertAssignee(ctx: RequestContext, userId: string, roles: Role[]) {
  const u = (await ctx.tx.select().from(schema.users).where(and(eq(schema.users.tenantId, ctx.auth.tenantId), eq(schema.users.id, userId))).limit(1))[0];
  if (!u || u.status !== "ACTIVE") throw errors.validation("Assignee must be an active user");
  if (!roles.includes(u.role as Role)) throw errors.validation(`Assignee must be ${roles.join(" or ")}`);
  return u;
}

export async function assign(ctx: RequestContext, caseId: string, ifMatch: number | null, input: { userId: string; reason?: string }) {
  const c = await lockCase(ctx, caseId, ifMatch);
  if (c.stage === "CLOSED") throw errors.gate("stage", "Closed cases cannot be assigned");
  const role = ctx.auth.role;
  let assignee;
  if (role === "ECOFY_ADMIN") {
    if (c.stage !== "S0") throw errors.forbidden("Ecofy Admin assigns at S0 only");
    assignee = await assertAssignee(ctx, input.userId, ["ECOFY_USER"]);
  } else {
    if (c.stage === "S0") throw errors.forbidden("iTarang Admin assigns from S1");
    assignee = await assertAssignee(ctx, input.userId, ["ITARANG_CALLER", "ITARANG_ADMIN"]);
  }
  if (c.assignedUserId && c.assignedUserId !== input.userId && !input.reason) throw errors.validation("reason is required when reassigning");
  if (c.assignedUserId === input.userId) return (await caseOut(ctx.tx, ctx.auth.tenantId, role, [c], { now: ctx.now }))[0];
  await ctx.tx.update(schema.caseAssignments).set({ endedAt: ctx.now }).where(and(eq(schema.caseAssignments.caseId, c.id), isNull(schema.caseAssignments.endedAt)));
  await ctx.tx.insert(schema.caseAssignments).values({ tenantId: c.tenantId, caseId: c.id, userId: input.userId, assignedBy: ctx.auth.userId, reason: input.reason ?? null, assignedAt: ctx.now });
  let next: CaseRow;
  if (c.stage === "S1") {
    next = await transition(ctx, { caseId: c.id, expectedVersion: c.version, to: "S2", set: { assignedUserId: input.userId }, reason: input.reason ?? "Assigned from queue", auditAction: "case.assign", eventType: "case.assigned", eventPayload: { userId: input.userId } });
  } else {
    next = await touchCase(ctx, c.id, c.version, { assignedUserId: input.userId }, { action: c.assignedUserId ? "case.reassign" : "case.assign", before: { assignedUserId: c.assignedUserId }, after: { assignedUserId: input.userId }, reason: input.reason ?? null });
    await emit(ctx, "case.assigned", c.id, { caseNo: c.caseNo, userId: input.userId });
  }
  await emit(ctx, "notification.created", c.id, { notify: [{ userId: input.userId, type: "case.assigned", title: `${c.caseNo} (${assignee.fullName === ctx.auth.fullName ? "self" : "assigned to you"})`, body: input.reason ?? undefined, caseId: c.id }] });
  return (await caseOut(ctx.tx, ctx.auth.tenantId, role, [next], { now: ctx.now }))[0];
}

export async function bulkAssign(ctx: RequestContext, input: { caseIds: string[]; userId: string; reason?: string }) {
  let assigned = 0;
  const skipped: Array<{ caseId: string; code: string }> = [];
  for (const id of input.caseIds) {
    try {
      // savepoint per case so one failure does not poison the transaction
      await ctx.tx.transaction(async (inner) => {
        await assign({ ...ctx, tx: inner }, id, null, input);
      });
      assigned++;
    } catch (e) {
      skipped.push({ caseId: id, code: (e as { code?: string }).code ?? "ERROR" });
    }
  }
  return { assigned, skipped };
}

// ------------------------------------------------------------------ temperature / push / close (FR-04.3, FR-04.4)
export async function setTemperature(ctx: RequestContext, caseId: string, ifMatch: number | null, input: { temperature: "COLD" | "WARM" | "HOT" | "NOT_INTERESTED"; note?: string; closureReason?: string }) {
  const c = await lockCase(ctx, caseId, ifMatch);
  if (c.stage !== "S0") throw errors.gate("stage", "Temperature is set at S0 only");
  const qualifiedBy = c.qualifiedBy ?? ctx.auth.userId;
  if (input.note) await ctx.tx.insert(schema.activities).values({ tenantId: c.tenantId, caseId: c.id, type: "REMARK", note: input.note, actorId: ctx.auth.userId, at: ctx.now });
  let next: CaseRow;
  if (input.temperature === "HOT") {
    next = await transition(ctx, {
      caseId: c.id, expectedVersion: c.version, to: "S1", set: { temperature: "HOT", qualifiedBy, queueEnteredAt: ctx.now, assignedUserId: null }, reason: "Hot lead",
      auditAction: "case.temperature", eventType: "case.temperature_set",
      eventPayload: { temperature: "HOT", notify: [{ role: "ITARANG_ADMIN", type: "queue.hot", title: `Hot lead ${c.caseNo} entered the queue`, caseId: c.id }] },
    });
    await ctx.tx.update(schema.caseAssignments).set({ endedAt: ctx.now }).where(and(eq(schema.caseAssignments.caseId, c.id), isNull(schema.caseAssignments.endedAt)));
  } else if (input.temperature === "NOT_INTERESTED") {
    if (!input.closureReason) throw errors.validation("closureReason is required for NOT_INTERESTED");
    await assertListCode(ctx.tx, c.tenantId, "closure_reason", input.closureReason, "closureReason", true);
    next = await transition(ctx, { caseId: c.id, expectedVersion: c.version, to: "CLOSED", set: { temperature: "NOT_INTERESTED", qualifiedBy, closureReason: input.closureReason, closureNote: input.note ?? null }, reason: input.closureReason, auditAction: "case.close", eventType: "case.closed", eventPayload: { closureReason: input.closureReason } });
  } else {
    next = await touchCase(ctx, c.id, c.version, { temperature: input.temperature, qualifiedBy }, { action: "case.temperature", before: { temperature: c.temperature }, after: { temperature: input.temperature } });
    await emit(ctx, "case.temperature_set", c.id, { caseNo: c.caseNo, temperature: input.temperature });
  }
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}

export async function pushToItarang(ctx: RequestContext, caseId: string, ifMatch: number | null, input: { note?: string }) {
  const c = await lockCase(ctx, caseId, ifMatch);
  if (c.stage !== "S0") throw errors.gate("stage", "Push is available at S0 only");
  if (c.temperature !== "WARM") throw errors.gate("temperature_warm", "Only Warm leads are pushed; Hot leads move automatically");
  if (input.note) await ctx.tx.insert(schema.activities).values({ tenantId: c.tenantId, caseId: c.id, type: "REMARK", note: input.note, actorId: ctx.auth.userId, at: ctx.now });
  const next = await transition(ctx, {
    caseId: c.id, expectedVersion: c.version, to: "S1", set: { qualifiedBy: c.qualifiedBy ?? ctx.auth.userId, queueEnteredAt: ctx.now, assignedUserId: null }, reason: "Pushed to iTarang",
    auditAction: "case.push", eventType: "case.pushed", eventPayload: { notify: [{ role: "ITARANG_ADMIN", type: "queue.warm", title: `Warm lead ${c.caseNo} pushed to the queue`, caseId: c.id }] },
  });
  await ctx.tx.update(schema.caseAssignments).set({ endedAt: ctx.now }).where(and(eq(schema.caseAssignments.caseId, c.id), isNull(schema.caseAssignments.endedAt)));
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}

/**
 * Bulk push (docs/CONFLICTS.md #26): every selected case goes through pushToItarang with the same gates
 * (S0, Warm, visible to the caller); one failure never blocks the others. Each pushed case fires its own
 * outbox event, so the iTarang CRM receives one `lead.pushed` per lead.
 */
export async function bulkPush(ctx: RequestContext, input: { caseIds: string[]; note?: string }) {
  let pushed = 0;
  const skipped: Array<{ caseId: string; code: string; gate: string | null; message: string }> = [];
  for (const id of input.caseIds) {
    try {
      // savepoint per case so one failure does not poison the transaction
      await ctx.tx.transaction(async (inner) => {
        await pushToItarang({ ...ctx, tx: inner }, id, null, { note: input.note });
      });
      pushed++;
    } catch (e) {
      const err = e as { code?: string; gate?: string; message?: string };
      skipped.push({ caseId: id, code: err.code ?? "ERROR", gate: err.gate ?? null, message: err.message ?? "Could not push" });
    }
  }
  return { pushed, skipped };
}

/** FR-14.1 close before acceptance (S0–S4) by the stage owner. */
export async function closeCase(ctx: RequestContext, caseId: string, ifMatch: number | null, input: { closureReason: string; note?: string }) {
  const c = await lockCase(ctx, caseId, ifMatch);
  const role = ctx.auth.role;
  if (c.stage === "CLOSED") throw errors.gate("stage", "Case is already closed");
  if (["S5", "S6", "S7", "S8"].includes(c.stage)) throw errors.gate("before_acceptance", "After acceptance a case closes only through a confirmed withdrawal");
  if (c.stage === "S0" && !(role === "ECOFY_ADMIN" || role === "ECOFY_USER")) throw errors.forbidden("At S0 only Ecofy closes the case");
  if (c.stage !== "S0" && !(role === "ITARANG_ADMIN" || role === "ITARANG_CALLER")) throw errors.forbidden("From S1 only iTarang closes the case");
  await assertListCode(ctx.tx, c.tenantId, "closure_reason", input.closureReason, "closureReason", true);
  const next = await transition(ctx, { caseId: c.id, expectedVersion: c.version, to: "CLOSED", set: { closureReason: input.closureReason, closureNote: input.note ?? null }, reason: input.closureReason, auditAction: "case.close", eventType: "case.closed", eventPayload: { closureReason: input.closureReason } });
  return (await caseOut(ctx.tx, ctx.auth.tenantId, role, [next], { now: ctx.now }))[0];
}

/** FR-14.7 reopen by iTarang Admin (the database blocks a case that reached a File). */
export async function reopenCase(ctx: RequestContext, caseId: string, ifMatch: number | null, reason: string) {
  const c = await lockCase(ctx, caseId, ifMatch);
  if (c.stage !== "CLOSED") throw errors.gate("stage", "Only closed cases reopen");
  const hasFile = (await ctx.tx.select({ id: schema.files.id }).from(schema.files).where(eq(schema.files.caseId, c.id)).limit(1))[0];
  if (hasFile) throw errors.gate("no_file", "A case that reached a File never reopens; create a new linked case");
  const next = await transition(ctx, { caseId: c.id, expectedVersion: c.version, to: "S0", set: { closureReason: null, closureNote: null, closedAt: null, temperature: null, reopenCount: c.reopenCount + 1, assignedUserId: c.qualifiedBy ?? null }, reason, auditAction: "case.reopen", eventType: "case.reopened" });
  await ctx.tx.update(schema.caseAssignments).set({ endedAt: ctx.now }).where(and(eq(schema.caseAssignments.caseId, c.id), isNull(schema.caseAssignments.endedAt)));
  if (c.qualifiedBy) await ctx.tx.insert(schema.caseAssignments).values({ tenantId: c.tenantId, caseId: c.id, userId: c.qualifiedBy, assignedBy: ctx.auth.userId, reason: "Reopened", assignedAt: ctx.now });
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}

void lt;
