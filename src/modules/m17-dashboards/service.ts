import { and, eq, sql, gte, lte, inArray } from "drizzle-orm";
import { stringify } from "csv-stringify/sync";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { getSetting } from "@/core/settings/settingsCache";
import { loadCalendar } from "@/core/calendar/loadCalendar";
import { workingHoursBetween, ageingBand } from "@/core/calendar/workingHours";
import { maskMobile } from "@/core/http/serialize";
import { isAdmin } from "@/core/auth/rbac";
import type { RequestContext } from "@/core/http/context";
import { logExport } from "@/modules/m18-audit/service";

const STAGES = ["S0", "S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "CLOSED"] as const;

/**
 * FR-17.1: funnel — open cases by stage (live) plus entries per stage in the period (from stage history),
 * filtered by user / segment. Users see their own (RLS + userId forced to self).
 */
export async function funnel(ctx: RequestContext, q: { from?: string; to?: string; userId?: string; segment?: "RESI" | "ESS" | "CI" }) {
  const admin = isAdmin(ctx.auth.role);
  const userId = admin ? q.userId : ctx.auth.userId;
  const conds = [eq(schema.cases.tenantId, ctx.auth.tenantId)];
  if (userId) conds.push(eq(schema.cases.assignedUserId, userId));
  if (q.segment) conds.push(eq(schema.cases.segment, q.segment));
  const open = await ctx.tx.select({ stage: schema.cases.stage, n: sql<number>`count(*)::int` }).from(schema.cases).where(and(...conds)).groupBy(schema.cases.stage);
  const hconds = [eq(schema.caseStageHistory.tenantId, ctx.auth.tenantId)];
  if (q.from) hconds.push(gte(schema.caseStageHistory.at, new Date(q.from)));
  if (q.to) hconds.push(lte(schema.caseStageHistory.at, new Date(q.to)));
  const caseIds = userId || q.segment ? (await ctx.tx.select({ id: schema.cases.id }).from(schema.cases).where(and(...conds))).map((c) => c.id) : null;
  if (caseIds && !caseIds.length) return { byStage: STAGES.map((s) => ({ stage: s, open: 0, entered: 0 })), conversion: {}, total: 0 };
  if (caseIds) hconds.push(inArray(schema.caseStageHistory.caseId, caseIds));
  const entered = await ctx.tx.select({ stage: schema.caseStageHistory.toStage, n: sql<number>`count(distinct case_id)::int` }).from(schema.caseStageHistory).where(and(...hconds)).groupBy(schema.caseStageHistory.toStage);
  const bySeg = admin ? await ctx.tx.select({ segment: schema.cases.segment, stage: schema.cases.stage, n: sql<number>`count(*)::int` }).from(schema.cases).where(and(...conds)).groupBy(schema.cases.segment, schema.cases.stage) : [];
  const byUser = admin ? await ctx.tx.select({ userId: schema.cases.assignedUserId, stage: schema.cases.stage, n: sql<number>`count(*)::int` }).from(schema.cases).where(and(...conds, sql`${schema.cases.stage} <> 'CLOSED'`)).groupBy(schema.cases.assignedUserId, schema.cases.stage) : [];
  const om = new Map(open.map((r) => [r.stage, Number(r.n)]));
  const em = new Map(entered.map((r) => [r.stage, Number(r.n)]));
  const byStage = STAGES.map((s) => ({ stage: s, open: om.get(s) ?? 0, entered: em.get(s) ?? 0 }));
  const conv = (a: string, b: string) => { const x = em.get(a as never) ?? 0; const y = em.get(b as never) ?? 0; return x ? Math.round((y / x) * 1000) / 10 : null; };
  return {
    byStage,
    total: [...om.values()].reduce((a, b) => a + b, 0),
    conversion: { s1FromS0: conv("S0", "S1"), s2FromS1: conv("S1", "S2"), s3FromS2: conv("S2", "S3"), s4FromS3: conv("S3", "S4"), s6FromS4: conv("S4", "S6"), s8FromS6: conv("S6", "S8") },
    bySegment: bySeg.map((r) => ({ segment: r.segment, stage: r.stage, n: Number(r.n) })),
    byUser: byUser.map((r) => ({ userId: r.userId, stage: r.stage, n: Number(r.n) })),
    period: { from: q.from ?? null, to: q.to ?? null },
  };
}

/** FR-17.2: time in stage and total open time, in working hours, in the configured bands. */
export async function ageing(ctx: RequestContext) {
  const cal = await loadCalendar(ctx.tx, ctx.auth.tenantId);
  const bands = [...((await getSetting(ctx.auth.tenantId, "ageing.bands_working_days", ctx.tx)) as readonly number[])];
  const rows = await ctx.tx.select({ id: schema.cases.id, caseNo: schema.cases.caseNo, stage: schema.cases.stage, assignedUserId: schema.cases.assignedUserId, stageEnteredAt: schema.cases.stageEnteredAt, createdAt: schema.cases.createdAt, queueEnteredAt: schema.cases.queueEnteredAt, firstCallAt: schema.cases.firstCallAt }).from(schema.cases).where(and(eq(schema.cases.tenantId, ctx.auth.tenantId), sql`${schema.cases.stage} <> 'CLOSED'`));
  const byStage: Record<string, Record<string, number>> = {};
  const list = rows.map((c) => {
    const inStage = workingHoursBetween(new Date(c.stageEnteredAt), ctx.now, cal);
    const open = workingHoursBetween(new Date(c.createdAt), ctx.now, cal);
    const band = ageingBand(inStage, bands);
    byStage[c.stage] ??= {};
    byStage[c.stage][band] = (byStage[c.stage][band] ?? 0) + 1;
    return { id: c.id, caseNo: c.caseNo, stage: c.stage, assignedUserId: c.assignedUserId, inStageWorkingHours: Math.round(inStage * 100) / 100, openWorkingHours: Math.round(open * 100) / 100, band, hotToFirstCallHours: c.queueEnteredAt && c.firstCallAt ? Math.round(((new Date(c.firstCallAt).getTime() - new Date(c.queueEnteredAt).getTime()) / 3600_000) * 100) / 100 : null };
  });
  return { bands, byStage, cases: list.sort((a, b) => b.inStageWorkingHours - a.inStageWorkingHours) };
}

/** FR-17.3 per-user activity (own or admin). */
export async function userStats(ctx: RequestContext, userId: string, q: { from?: string; to?: string }) {
  if (!isAdmin(ctx.auth.role) && userId !== ctx.auth.userId) throw errors.forbidden("Users see their own statistics only");
  const from = q.from ? new Date(q.from) : new Date(0);
  const to = q.to ? new Date(q.to) : ctx.now;
  const t = ctx.auth.tenantId;
  const [calls, remarks] = await Promise.all([
    ctx.tx.select({ n: sql<number>`count(*)::int` }).from(schema.activities).where(and(eq(schema.activities.tenantId, t), eq(schema.activities.actorId, userId), eq(schema.activities.type, "CALL"), gte(schema.activities.at, from), lte(schema.activities.at, to))),
    ctx.tx.select({ n: sql<number>`count(*)::int` }).from(schema.activities).where(and(eq(schema.activities.tenantId, t), eq(schema.activities.actorId, userId), inArray(schema.activities.type, ["REMARK", "COMMENT", "FOLLOW_UP"]), gte(schema.activities.at, from), lte(schema.activities.at, to))),
  ]);
  const appts = await ctx.tx.select({ status: schema.appointments.status, type: schema.appointments.meetingType, n: sql<number>`count(*)::int` }).from(schema.appointments).where(and(eq(schema.appointments.tenantId, t), eq(schema.appointments.createdBy, userId), gte(schema.appointments.createdAt, from), lte(schema.appointments.createdAt, to))).groupBy(schema.appointments.status, schema.appointments.meetingType);
  const scheduled = appts.reduce((a, r) => a + Number(r.n), 0);
  const held = appts.filter((r) => r.status === "COMPLETED").reduce((a, r) => a + Number(r.n), 0);
  const noShow = appts.filter((r) => r.status === "NO_SHOW").reduce((a, r) => a + Number(r.n), 0);
  const epcVisits = appts.filter((r) => r.type === "EPC_VISIT").reduce((a, r) => a + Number(r.n), 0);
  const count = async (table: any, byCol: any, atCol: any): Promise<number> => {
    const rows = (await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(table).where(and(eq(table.tenantId, t), eq(byCol, userId), gte(atCol, from), lte(atCol, to)))) as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  };
  const assessments = await count(schema.assessments, schema.assessments.createdBy, schema.assessments.createdAt);
  const quotes = await count(schema.quotes, schema.quotes.uploadedBy, schema.quotes.createdAt);
  const offers = await count(schema.offers, schema.offers.createdBy, schema.offers.createdAt);
  const files = Number((await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(schema.files).innerJoin(schema.otpChallenges, eq(schema.otpChallenges.id, schema.files.otpChallengeId)).where(and(eq(schema.files.tenantId, t), eq(schema.otpChallenges.triggeredBy, userId), gte(schema.files.acceptedAt, from), lte(schema.files.acceptedAt, to))))[0]?.n ?? 0);
  const hot = await ctx.tx.select({ avg: sql<number>`avg(extract(epoch from (first_call_at - queue_entered_at)) / 3600)` }).from(schema.cases).where(and(eq(schema.cases.tenantId, t), eq(schema.cases.assignedUserId, userId), sql`first_call_at is not null and queue_entered_at is not null`));
  return { userId, period: { from, to }, calls: Number(calls[0]?.n ?? 0), remarks: Number(remarks[0]?.n ?? 0), appointmentsScheduled: scheduled, appointmentsHeld: held, noShowRate: scheduled ? Math.round((noShow / scheduled) * 1000) / 10 : null, epcVisits, assessments, quotesUploaded: quotes, offers, files, hotToFirstCallHoursAvg: hot[0]?.avg == null ? null : Math.round(Number(hot[0].avg) * 100) / 100 };
}

/** FR-17.7 usage view: seats by role, Files per month and to date, active assets. Counts only; never blocks. */
export async function usage(ctx: RequestContext) {
  const t = ctx.auth.tenantId;
  const seats = await ctx.tx.select().from(schema.seatLimits).where(eq(schema.seatLimits.tenantId, t));
  const perMonth = await ctx.tx.select({ month: sql<string>`to_char(accepted_at at time zone 'Asia/Kolkata', 'YYYY-MM')`, n: sql<number>`count(*)::int` }).from(schema.files).where(eq(schema.files.tenantId, t)).groupBy(sql`1`).orderBy(sql`1`);
  const total = Number((await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(schema.files).where(eq(schema.files.tenantId, t)))[0]?.n ?? 0);
  const assets = Number((await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(schema.assets).where(and(eq(schema.assets.tenantId, t), eq(schema.assets.status, "ACTIVE"))))[0]?.n ?? 0);
  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(ctx.now).slice(0, 7);
  const seatsByRole = Object.fromEntries(seats.map((s) => [s.role, { used: s.seatsUsed, limit: s.seatLimit }]));
  return [{ month, seatsByRole, filesCreated: Number(perMonth.find((m) => m.month === month)?.n ?? 0), filesToDate: total, activeAssets: assets, filesByMonth: perMonth.map((m) => ({ month: m.month, files: Number(m.n) })) }];
}

/** FR-17.5 CSV exports (admins only; logged; mobiles masked). Codes: cases, funnel, ageing, activities, files. */
export async function reportCsv(ctx: RequestContext, code: string, filters: Record<string, string>) {
  let records: Record<string, unknown>[] = [];
  if (code === "cases") {
    const rows = await ctx.tx.select().from(schema.cases).where(eq(schema.cases.tenantId, ctx.auth.tenantId));
    const customers = rows.length ? await ctx.tx.select().from(schema.customers).where(inArray(schema.customers.id, rows.map((r) => r.customerId))) : [];
    const cm = new Map(customers.map((c) => [c.id, c]));
    const mask = Boolean(await getSetting(ctx.auth.tenantId, "exports.mask_mobile_in_lists", ctx.tx));
    records = rows.filter((r) => !filters.stage || r.stage === filters.stage).map((r) => ({ case_no: r.caseNo, stage: r.stage, sub_status: r.subStatus, segment: r.segment, temperature: r.temperature, source: r.source, customer: cm.get(r.customerId)?.fullName, mobile: mask ? maskMobile(cm.get(r.customerId)?.mobileE164) : cm.get(r.customerId)?.mobileE164, city: cm.get(r.customerId)?.city, assigned_user_id: r.assignedUserId, stage_entered_at: r.stageEnteredAt.toISOString(), created_at: r.createdAt.toISOString(), closed_at: r.closedAt?.toISOString() ?? "", closure_reason: r.closureReason ?? "" }));
  } else if (code === "funnel") {
    const f = await funnel(ctx, { from: filters.from, to: filters.to, segment: filters.segment as never });
    records = f.byStage;
  } else if (code === "ageing") {
    records = (await ageing(ctx)).cases;
  } else if (code === "activities") {
    const rows = await ctx.tx.select().from(schema.activities).where(eq(schema.activities.tenantId, ctx.auth.tenantId));
    records = rows.map((a) => ({ id: Number(a.id), case_id: a.caseId, type: a.type, call_outcome: a.callOutcome, note: a.note, next_follow_up_at: a.nextFollowUpAt?.toISOString() ?? "", actor_id: a.actorId, at: a.at.toISOString() }));
  } else if (code === "files") {
    const rows = await ctx.tx.select().from(schema.files).where(eq(schema.files.tenantId, ctx.auth.tenantId));
    records = rows.map((f) => ({ file_no: f.fileNo, case_id: f.caseId, quote_version: f.quoteVersion, accepted_total_inr: f.acceptedTotalInr, accepted_at: f.acceptedAt.toISOString() }));
  } else if (code === "financing" && ctx.auth.role === "ECOFY_ADMIN") {
    // FR-17.6: financing values only in EA's reports (RLS returns only Ecofy's rows)
    const rows = await ctx.tx.select({ caseId: schema.financingDecisions.caseId, attemptNo: schema.financingDecisions.attemptNo, status: schema.financingDecisions.status, decidedAt: schema.financingDecisions.decidedAt, sanctionedInr: schema.financingValues.sanctionedInr, downPaymentInr: schema.financingValues.downPaymentInr, tenureMonths: schema.financingValues.tenureMonths, emiInr: schema.financingValues.emiInr }).from(schema.financingDecisions).leftJoin(schema.financingValues, eq(schema.financingValues.decisionId, schema.financingDecisions.id)).where(eq(schema.financingDecisions.tenantId, ctx.auth.tenantId));
    records = rows.map((r) => ({ ...r, decidedAt: r.decidedAt?.toISOString() ?? "" }));
  } else {
    throw errors.notFound("Report");
  }
  await logExport(ctx, code, filters, records.length);
  return stringify(records, { header: true });
}
