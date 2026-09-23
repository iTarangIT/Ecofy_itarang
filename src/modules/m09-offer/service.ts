import { and, eq, desc, max, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { schema, type Tx } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { getSetting } from "@/core/settings/settingsCache";
import { istDate } from "@/core/calendar/dates";
import { setSubStatus, lockCase, touchCase, type CaseRow } from "@/core/state-engine/transition";
import { encodeCursor, decodeCursor } from "@/core/http/serialize";
import type { RequestContext } from "@/core/http/context";
import type { Role } from "@/core/auth/rbac";
import { requireCase } from "@/modules/m04-qualify/service";
import { caseOut } from "@/modules/m04-qualify/caseView";
import { financierById } from "@/modules/m02-settings/service";
import { startUpload, requireCommittedDocument } from "@/modules/m15-documents/service";
import type { EligibilityDecision, QuoteRequestCreate, QuoteCreateT } from "./schemas";

// ------------------------------------------------------------------ eligibility (FR-09.1 … FR-09.3, FR-09.10)

/** ELIGIBLE check for the case's current financier (the amount stays in eligibility_values, RLS-guarded). */
export async function currentEligibility(tx: Tx, c: CaseRow) {
  if (!c.financierId) return null;
  const r = await tx.select().from(schema.eligibilityChecks).where(and(eq(schema.eligibilityChecks.caseId, c.id), eq(schema.eligibilityChecks.financierId, c.financierId))).orderBy(desc(schema.eligibilityChecks.requestedAt)).limit(1);
  return r[0] ?? null;
}

export async function isEligible(tx: Tx, c: CaseRow): Promise<boolean> {
  const e = await currentEligibility(tx, c);
  return e?.status === "ELIGIBLE";
}

export async function sendForEligibility(ctx: RequestContext, caseId: string, input: { financierId?: string }) {
  const c = await requireCase(ctx, caseId);
  if (c.stage !== "S4") throw errors.gate("stage", `Eligibility is requested at S4 (case is at ${c.stage})`);
  const financierId = input.financierId ?? c.financierId;
  if (!financierId) throw errors.validation("The case has no financier");
  const fin = await financierById(ctx.tx, c.tenantId, financierId);
  if (!fin.active) throw errors.validation("Financier is inactive");
  if (financierId !== c.financierId) await touchCase(ctx, c.id, null, { financierId }, { action: "case.financier", before: { financierId: c.financierId }, after: { financierId } });
  const row = (await ctx.tx.insert(schema.eligibilityChecks).values({ tenantId: c.tenantId, caseId: c.id, financierId, status: "REQUESTED", requestedBy: ctx.auth.userId, requestedAt: ctx.now }).returning())[0];
  await setSubStatus(ctx, c.id, null, "ELIGIBILITY_PENDING", "Sent for eligibility");
  await audit(ctx, { action: "eligibility.request", entityType: "eligibility_check", entityId: row.id, caseId: c.id, after: { financierId } });
  await emit(ctx, "eligibility.requested", row.id, { caseId: c.id, financierId, notify: [{ role: fin.valuesVisibleTo as Role, type: "eligibility.requested", title: `${c.caseNo} awaits an eligibility decision`, caseId: c.id }] });
  return { id: row.id, status: row.status, financierId, requestedAt: row.requestedAt };
}

/** EA: Ecofy's queue; IA: other financiers' queue (role per financier). */
export async function eligibilityQueue(ctx: RequestContext, q: { cursor?: string; limit?: number }) {
  const limit = q.limit ?? 50;
  const fins = await ctx.tx.select({ id: schema.financiers.id }).from(schema.financiers).where(and(eq(schema.financiers.tenantId, ctx.auth.tenantId), eq(schema.financiers.valuesVisibleTo, ctx.auth.role)));
  if (!fins.length) return { data: [], meta: { nextCursor: null, limit } };
  const cur = decodeCursor<{ at: string; id: string }>(q.cursor);
  const conds = [eq(schema.eligibilityChecks.tenantId, ctx.auth.tenantId), inArray(schema.eligibilityChecks.financierId, fins.map((f) => f.id)), inArray(schema.eligibilityChecks.status, ["REQUESTED", "INFO_NEEDED"])];
  if (cur) conds.push(sql`(${schema.eligibilityChecks.requestedAt}, ${schema.eligibilityChecks.id}) > (${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const checks = await ctx.tx.select().from(schema.eligibilityChecks).where(and(...conds)).orderBy(schema.eligibilityChecks.requestedAt, schema.eligibilityChecks.id).limit(limit + 1);
  const page = checks.slice(0, limit);
  const cases = page.length ? await ctx.tx.select().from(schema.cases).where(inArray(schema.cases.id, page.map((c) => c.caseId))) : [];
  const out = await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, cases, { list: true, now: ctx.now });
  const byCase = new Map(out.map((c) => [c.id, c]));
  const data = page.map((ch) => ({ ...byCase.get(ch.caseId), eligibility: { id: ch.id, status: ch.status, requestedAt: ch.requestedAt, reason: ch.reason } })).filter((x) => x.id);
  const last = page[page.length - 1];
  return { data, meta: { nextCursor: checks.length > limit && last ? encodeCursor({ at: last.requestedAt.toISOString(), id: last.id }) : null, limit } };
}

export async function decideEligibility(ctx: RequestContext, checkId: string, input: z.infer<typeof EligibilityDecision>) {
  const ch = (await ctx.tx.select().from(schema.eligibilityChecks).where(and(eq(schema.eligibilityChecks.tenantId, ctx.auth.tenantId), eq(schema.eligibilityChecks.id, checkId))).limit(1))[0];
  if (!ch) throw errors.notFound("Eligibility check");
  const fin = await financierById(ctx.tx, ctx.auth.tenantId, ch.financierId);
  if (fin.valuesVisibleTo !== ctx.auth.role) throw errors.forbidden(`Only ${fin.valuesVisibleTo} records decisions for ${fin.name}`);
  if (!["REQUESTED", "INFO_NEEDED"].includes(ch.status)) throw errors.validation(`Eligibility is already ${ch.status}`);
  const c = await lockCase(ctx, ch.caseId, null);
  if (input.status === "ELIGIBLE" && !input.maxEligibleInr) throw errors.validation("maxEligibleInr is required for ELIGIBLE");
  if (input.status !== "ELIGIBLE" && !input.reason) throw errors.validation("reason is required");
  await ctx.tx.update(schema.eligibilityChecks).set({ status: input.status, reason: input.reason ?? null, decidedBy: ctx.auth.userId, decidedAt: ctx.now }).where(eq(schema.eligibilityChecks.id, ch.id));
  if (input.status === "ELIGIBLE") {
    await ctx.tx.insert(schema.eligibilityValues).values({ eligibilityId: ch.id, tenantId: c.tenantId, visibleTo: ctx.auth.role, maxEligibleInr: input.maxEligibleInr!, recordedBy: ctx.auth.userId, recordedAt: ctx.now });
    const activeQuote = await activeQuoteOf(ctx.tx, c.id);
    await setSubStatus(ctx, c.id, null, activeQuote ? "OFFER_READY" : "QUOTE_PENDING", "Eligible");
  } else if (input.status === "NOT_ELIGIBLE") {
    await setSubStatus(ctx, c.id, null, "NOT_ELIGIBLE", input.reason);
  }
  await audit(ctx, { action: "eligibility.decide", entityType: "eligibility_check", entityId: ch.id, caseId: c.id, after: { status: input.status, hasAmount: input.status === "ELIGIBLE" }, reason: input.reason });
  await emit(ctx, "eligibility.decided", ch.id, {
    caseId: c.id, status: input.status,
    notify: c.assignedUserId ? [{ userId: c.assignedUserId, type: "eligibility.decided", title: `${c.caseNo}: ${input.status.replace("_", " ").toLowerCase()}`, body: input.status === "INFO_NEEDED" ? input.reason : undefined, caseId: c.id }] : [],
  });
}

// ------------------------------------------------------------------ quote requests (FR-09.4)
export async function createQuoteRequest(ctx: RequestContext, caseId: string, input: z.infer<typeof QuoteRequestCreate>) {
  const c = await requireCase(ctx, caseId);
  if (!["S3", "S4"].includes(c.stage)) throw errors.gate("stage", "Quote requests are logged at S3 or S4");
  const p = (await ctx.tx.select({ id: schema.epcPartners.id, active: schema.epcPartners.active }).from(schema.epcPartners).where(and(eq(schema.epcPartners.tenantId, c.tenantId), eq(schema.epcPartners.id, input.epcPartnerId))).limit(1))[0];
  if (!p || !p.active) throw errors.validation("EPC partner not found or inactive");
  const row = (await ctx.tx.insert(schema.quoteRequests).values({ tenantId: c.tenantId, caseId: c.id, epcPartnerId: input.epcPartnerId, channel: input.channel, status: "REQUESTED", requestedBy: ctx.auth.userId, requestedAt: ctx.now }).returning())[0];
  await audit(ctx, { action: "quote.request", entityType: "quote_request", entityId: row.id, caseId: c.id, after: { epcPartnerId: input.epcPartnerId, channel: input.channel } });
  return { id: row.id, caseId: c.id, epcPartnerId: row.epcPartnerId, channel: row.channel, status: row.status, requestedAt: row.requestedAt };
}

export async function patchQuoteRequest(ctx: RequestContext, id: string, status: "RECEIVED" | "DECLINED") {
  const qr = (await ctx.tx.select().from(schema.quoteRequests).where(and(eq(schema.quoteRequests.tenantId, ctx.auth.tenantId), eq(schema.quoteRequests.id, id))).limit(1))[0];
  if (!qr) throw errors.notFound("Quote request");
  await requireCase(ctx, qr.caseId);
  await ctx.tx.update(schema.quoteRequests).set({ status }).where(eq(schema.quoteRequests.id, qr.id));
  await audit(ctx, { action: "quote.request_status", entityType: "quote_request", entityId: qr.id, caseId: qr.caseId, before: { status: qr.status }, after: { status } });
}

// ------------------------------------------------------------------ quotes (FR-09.4, FR-09.7 … FR-09.9)
export type QuoteRow = typeof schema.quotes.$inferSelect;

export function quoteOut(q: QuoteRow) {
  return {
    id: q.id, caseId: q.caseId, version: q.version, status: q.status, epcPartnerId: q.epcPartnerId, quoteRequestId: q.quoteRequestId, assessmentId: q.assessmentId, documentId: q.documentId,
    provisional: q.provisional, provisionalReason: q.provisionalReason, systemDesc: q.systemDesc,
    batteryKwh: q.batteryKwh === null ? null : Number(q.batteryKwh), inverterKva: q.inverterKva === null ? null : Number(q.inverterKva), solarKwp: q.solarKwp === null ? null : Number(q.solarKwp),
    equipmentInr: q.equipmentInr, installationInr: q.installationInr, gstInr: q.gstInr, totalInr: q.totalInr, validUntil: q.validUntil, notes: q.notes, uploadedBy: q.uploadedBy, createdAt: q.createdAt,
  };
}

export async function activeQuoteOf(tx: Tx, caseId: string): Promise<QuoteRow | null> {
  const r = await tx.select().from(schema.quotes).where(and(eq(schema.quotes.caseId, caseId), eq(schema.quotes.status, "ACTIVE"))).limit(1);
  return r[0] ?? null;
}

export async function listQuotes(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const rows = await ctx.tx.select().from(schema.quotes).where(eq(schema.quotes.caseId, c.id)).orderBy(desc(schema.quotes.version));
  return rows.map(quoteOut);
}

export async function quoteUploadUrl(ctx: RequestContext, caseId: string, input: { fileName: string; mimeType: "application/pdf" | "image/jpeg" | "image/png" | "audio/mpeg" | "audio/mp4" | "audio/wav"; sizeBytes: number }) {
  if (input.mimeType !== "application/pdf") throw errors.validation("An EPC quote must be a PDF");
  return startUpload(ctx, caseId, { typeCode: "EPC_QUOTE", fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes }, { keyPrefix: "quotes" });
}

/** S4 order gate (FR-09.1, UAT-17): ELIGIBILITY_FIRST blocks the quote upload until the case is eligible. */
async function assertQuoteAllowedByOrder(ctx: RequestContext, c: CaseRow) {
  const order = String(await getSetting(c.tenantId, "gates.s4_order", ctx.tx));
  if (order === "ELIGIBILITY_FIRST" && !(await isEligible(ctx.tx, c))) throw errors.gate("s4_order", "Eligibility first: the case must be ELIGIBLE before a quote is uploaded (setting gates.s4_order)");
}

export async function createQuote(ctx: RequestContext, caseId: string, input: QuoteCreateT) {
  const c = await lockCase(ctx, caseId, null);
  if (c.stage !== "S4") throw errors.gate("stage", `Quotes are uploaded at S4 (case is at ${c.stage})`);
  await assertQuoteAllowedByOrder(ctx, c);
  await requireCommittedDocument(ctx, c.id, input.documentId, "EPC_QUOTE");
  const a = (await ctx.tx.select().from(schema.assessments).where(and(eq(schema.assessments.id, input.assessmentId), eq(schema.assessments.caseId, c.id))).limit(1))[0];
  if (!a) throw errors.validation("assessmentId must be an assessment of this case");
  if (a.recommendationStatus === "PENDING_TECHNICAL_DATA") {
    if (!input.provisional) throw errors.validation("The assessment is PENDING_TECHNICAL_DATA: the quote must be marked provisional with a reason (earned rule 3)");
    if (!input.provisionalReason) throw errors.validation("provisionalReason is required for a provisional quote");
  }
  if (input.provisional && !input.provisionalReason) throw errors.validation("provisionalReason is required for a provisional quote");
  if (input.validUntil < istDate(ctx.now)) throw errors.validation("validUntil is in the past");
  const p = (await ctx.tx.select({ id: schema.epcPartners.id }).from(schema.epcPartners).where(and(eq(schema.epcPartners.tenantId, c.tenantId), eq(schema.epcPartners.id, input.epcPartnerId))).limit(1))[0];
  if (!p) throw errors.validation("EPC partner not found");
  // a new version supersedes the old (FR-09.4); draft offers on the old quote are superseded too
  const prev = await activeQuoteOf(ctx.tx, c.id);
  if (prev) {
    await ctx.tx.update(schema.quotes).set({ status: "SUPERSEDED" }).where(eq(schema.quotes.id, prev.id));
    await ctx.tx.update(schema.offers).set({ status: "SUPERSEDED" }).where(and(eq(schema.offers.quoteId, prev.id), inArray(schema.offers.status, ["DRAFT", "SENT"])));
  }
  const last = (await ctx.tx.select({ v: max(schema.quotes.version) }).from(schema.quotes).where(eq(schema.quotes.caseId, c.id)))[0]?.v ?? 0;
  const row = (await ctx.tx.insert(schema.quotes).values({
    tenantId: c.tenantId, caseId: c.id, version: Number(last) + 1, epcPartnerId: input.epcPartnerId, quoteRequestId: input.quoteRequestId ?? null, assessmentId: a.id,
    provisional: Boolean(input.provisional), provisionalReason: input.provisional ? input.provisionalReason ?? null : null, documentId: input.documentId, systemDesc: input.systemDesc,
    batteryKwh: input.batteryKwh == null ? null : String(input.batteryKwh), inverterKva: input.inverterKva == null ? null : String(input.inverterKva), solarKwp: input.solarKwp == null ? null : String(input.solarKwp),
    equipmentInr: input.equipmentInr, installationInr: input.installationInr, gstInr: input.gstInr, validUntil: input.validUntil, notes: input.notes ?? null, status: "ACTIVE", uploadedBy: ctx.auth.userId, createdAt: ctx.now,
  }).returning())[0];
  if (input.quoteRequestId) await ctx.tx.update(schema.quoteRequests).set({ status: "RECEIVED" }).where(and(eq(schema.quoteRequests.id, input.quoteRequestId), eq(schema.quoteRequests.caseId, c.id)));
  const eligible = await isEligible(ctx.tx, c);
  await setSubStatus(ctx, c.id, null, eligible ? "OFFER_READY" : "ELIGIBILITY_PENDING", `Quote v${row.version} uploaded`);
  await audit(ctx, { action: "quote.upload", entityType: "quote", entityId: row.id, caseId: c.id, after: { version: row.version, totalInr: row.totalInr, provisional: row.provisional, supersedes: prev?.id ?? null }, reason: row.provisionalReason });
  await emit(ctx, "quote.uploaded", row.id, { caseId: c.id, version: row.version, provisional: row.provisional });
  return quoteOut(row);
}

// ------------------------------------------------------------------ offers (FR-09.5, FR-09.6, FR-09.8)
export type OfferRow = typeof schema.offers.$inferSelect;

export function offerOut(o: OfferRow) {
  const content = (o.content ?? {}) as Record<string, unknown>;
  return {
    id: o.id, caseId: o.caseId, quoteId: o.quoteId, version: o.version, status: o.status,
    limitCheck: o.withinLimit === null ? "UNKNOWN" : o.withinLimit ? "WITHIN" : "ABOVE",
    provisional: Boolean(content.provisional),
    content: { system: content.system, equipmentInr: content.equipmentInr, installationInr: content.installationInr, gstInr: content.gstInr, totalInr: content.totalInr, financingLine: content.financingLine, provisionalReason: content.provisionalReason ?? null, validUntil: content.validUntil },
    createdBy: o.createdBy, createdAt: o.createdAt, sentAt: o.sentAt,
  };
}

/** offer_within_limit(): SECURITY DEFINER, returns only yes/no; null when no ELIGIBLE check exists. */
export async function withinLimit(tx: Tx, caseId: string, total: number): Promise<boolean | null> {
  const rows = (await tx.execute(sql`select offer_within_limit(${caseId}::uuid, ${total}::int) as ok`)) as unknown as Array<{ ok: boolean | null }>;
  return rows[0]?.ok ?? null;
}

export async function createOffer(ctx: RequestContext, caseId: string, quoteId: string) {
  const c = await lockCase(ctx, caseId, null);
  if (c.stage !== "S4") throw errors.gate("stage", `Offers are composed at S4 (case is at ${c.stage})`);
  const q = (await ctx.tx.select().from(schema.quotes).where(and(eq(schema.quotes.id, quoteId), eq(schema.quotes.caseId, c.id))).limit(1))[0];
  if (!q) throw errors.validation("quoteId must be a quote of this case");
  if (q.status !== "ACTIVE") throw errors.gate("quote_active", `Quote v${q.version} is ${q.status}; only the ACTIVE quote can be offered`);
  if (q.validUntil < istDate(ctx.now)) throw errors.gate("quote_valid", `Quote v${q.version} expired on ${q.validUntil}`);
  if (q.provisional && !(await getSetting(c.tenantId, "gates.allow_provisional_quote_acceptance", ctx.tx))) throw errors.gate("provisional_quote", "Provisional quotes cannot be offered (setting gates.allow_provisional_quote_acceptance)");
  await ctx.tx.update(schema.offers).set({ status: "SUPERSEDED" }).where(and(eq(schema.offers.caseId, c.id), eq(schema.offers.status, "DRAFT")));
  const financingLine = "Financing through Ecofy, subject to sanction.";
  const content = { system: q.systemDesc, equipmentInr: q.equipmentInr, installationInr: q.installationInr, gstInr: q.gstInr, totalInr: q.totalInr ?? q.equipmentInr + q.installationInr + q.gstInr, financingLine, provisional: q.provisional, provisionalReason: q.provisionalReason, validUntil: q.validUntil, quoteVersion: q.version };
  const total = q.totalInr ?? q.equipmentInr + q.installationInr + q.gstInr;
  const within = await withinLimit(ctx.tx, c.id, total);
  const last = (await ctx.tx.select({ v: max(schema.offers.version) }).from(schema.offers).where(eq(schema.offers.caseId, c.id)))[0]?.v ?? 0;
  const row = (await ctx.tx.insert(schema.offers).values({ tenantId: c.tenantId, caseId: c.id, quoteId: q.id, version: Number(last) + 1, withinLimit: within, content, status: "DRAFT", createdBy: ctx.auth.userId, createdAt: ctx.now }).returning())[0];
  await setSubStatus(ctx, c.id, null, "OFFER_READY", `Offer v${row.version} composed`);
  await audit(ctx, { action: "offer.compose", entityType: "offer", entityId: row.id, caseId: c.id, after: { version: row.version, quoteId: q.id, limitCheck: within === null ? "UNKNOWN" : within ? "WITHIN" : "ABOVE" } });
  await emit(ctx, "offer.composed", row.id, { caseId: c.id, version: row.version, aboveLimit: within === false });
  return offerOut(row);
}

export async function getOffer(ctx: RequestContext, offerId: string) {
  const o = (await ctx.tx.select().from(schema.offers).where(and(eq(schema.offers.tenantId, ctx.auth.tenantId), eq(schema.offers.id, offerId))).limit(1))[0];
  if (!o) throw errors.notFound("Offer");
  await requireCase(ctx, o.caseId);
  return offerOut(o);
}

export async function listOffers(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const rows = await ctx.tx.select().from(schema.offers).where(eq(schema.offers.caseId, c.id)).orderBy(desc(schema.offers.version));
  return rows.map(offerOut);
}
