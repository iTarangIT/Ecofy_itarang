import { and, eq, desc, gte, sql, count } from "drizzle-orm";
import { createHash, randomInt } from "node:crypto";
import { schema, type Tx } from "@/core/db/client";
import { withDbContext } from "@/core/db/tx";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { getSetting } from "@/core/settings/settingsCache";
import { istDate } from "@/core/calendar/dates";
import { config } from "@/core/config";
import { transition, lockCase, touchCase, type CaseRow } from "@/core/state-engine/transition";
import type { RequestContext } from "@/core/http/context";
import type { Role } from "@/core/auth/rbac";
import { requireCase } from "@/modules/m04-qualify/service";
import { isEligible } from "@/modules/m09-offer/service";
import { financierById } from "@/modules/m02-settings/service";

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
export const maskMobile = (m: string) => m.replace(/^(\+91)\d{6}(\d{4})$/, "$1******$2");

export type OtpRow = typeof schema.otpChallenges.$inferSelect;

/**
 * `devCode` is the plaintext OTP and is present ONLY when OTP_DEV_ECHO=true (sandbox/test): it lets testers read the
 * code on screen when SMS_DRIVER=dev writes the message to disk instead of a phone. Production never sets the flag.
 */
export function otpOut(o: OtpRow, maxAttempts: number, resendAfterSeconds: number, devCode?: string) {
  return {
    challengeId: o.id, offerId: o.offerId, purpose: o.purpose, status: o.status, expiresAt: o.expiresAt, resendAfterSeconds, maskedMobile: maskMobile(o.mobileE164), attemptsRemaining: Math.max(0, maxAttempts - o.attempts), sentAt: o.sentAt,
    ...(devCode && config().otpDevEcho ? { devCode } : {}),
  };
}

async function otpSettings(tenantId: string, tx: Tx) {
  return {
    expiryMinutes: Number(await getSetting(tenantId, "otp.expiry_minutes", tx)),
    maxAttempts: Number(await getSetting(tenantId, "otp.max_attempts", tx)),
    resendAfter: Number(await getSetting(tenantId, "otp.resend_after_seconds", tx)),
    maxSendsPerHour: Number(await getSetting(tenantId, "otp.max_sends_per_offer_per_hour", tx)),
    length: Number(await getSetting(tenantId, "otp.length", tx)),
  };
}

/**
 * Creates an OTP challenge for an offer (acceptance or re-acceptance) and queues the SMS.
 * Terms are immutable and one SENT challenge exists per offer, so a resend expires the old one and inserts a new one.
 */
export async function issueOtp(ctx: RequestContext, c: CaseRow, offer: typeof schema.offers.$inferSelect, purpose: "ACCEPTANCE" | "REACCEPTANCE", idempotencyKey: string, smsText: (code: string, expiryMinutes: number) => string, dltTemplateId: string) {
  const s = await otpSettings(c.tenantId, ctx.tx);
  const live = (await ctx.tx.select().from(schema.otpChallenges).where(and(eq(schema.otpChallenges.offerId, offer.id), eq(schema.otpChallenges.status, "SENT"))).limit(1))[0];
  if (live) {
    const since = (ctx.now.getTime() - new Date(live.sentAt).getTime()) / 1000;
    if (since < s.resendAfter) throw errors.rateLimited(`Resend allowed after ${Math.ceil(s.resendAfter - since)} s`, { retryAfterSeconds: Math.ceil(s.resendAfter - since) });
    await ctx.tx.update(schema.otpChallenges).set({ status: "EXPIRED" }).where(eq(schema.otpChallenges.id, live.id));
  }
  const sends = (await ctx.tx.select({ n: count() }).from(schema.otpChallenges).where(and(eq(schema.otpChallenges.offerId, offer.id), eq(schema.otpChallenges.purpose, purpose), gte(schema.otpChallenges.sentAt, new Date(ctx.now.getTime() - 3600_000)))))[0]?.n ?? 0;
  if (Number(sends) >= s.maxSendsPerHour) throw errors.rateLimited(`At most ${s.maxSendsPerHour} OTP sends per offer per hour`);
  const customer = (await ctx.tx.select({ mobile: schema.customers.mobileE164 }).from(schema.customers).where(eq(schema.customers.id, c.customerId)).limit(1))[0];
  if (!customer) throw errors.internal("customer missing");
  const code = String(randomInt(0, 10 ** s.length)).padStart(s.length, "0");
  const expiresAt = new Date(ctx.now.getTime() + s.expiryMinutes * 60_000);
  const row = (await ctx.tx.insert(schema.otpChallenges).values({
    tenantId: c.tenantId, caseId: c.id, offerId: offer.id, purpose, mobileE164: customer.mobile, codeHash: hashCode(code), status: "SENT", attempts: 0, sentAt: ctx.now, expiresAt, triggeredBy: ctx.auth.userId, idempotencyKey: `${idempotencyKey}:${purpose}:${Number(sends) + 1}`,
  }).returning())[0];
  const sms = (await ctx.tx.insert(schema.smsMessages).values({ tenantId: c.tenantId, caseId: c.id, dltTemplateId, toMobileE164: customer.mobile, purpose: purpose === "ACCEPTANCE" ? "ACCEPTANCE_OTP" : "REACCEPTANCE_OTP", provider: "GUPSHUP", status: "QUEUED" }).returning({ id: schema.smsMessages.id }))[0];
  await emit(ctx, "job.sms.send", c.id, { smsMessageId: Number(sms.id), to: customer.mobile, text: smsText(code, s.expiryMinutes), dltTemplateId, purpose: purpose === "ACCEPTANCE" ? "ACCEPTANCE_OTP" : "REACCEPTANCE_OTP", senderId: await getSetting(c.tenantId, "sms.sender_id", ctx.tx) });
  await emit(ctx, "otp.sent", row.id, { caseId: c.id, offerId: offer.id, purpose });
  await audit(ctx, { action: "otp.send", entityType: "otp_challenge", entityId: row.id, caseId: c.id, after: { purpose, offerId: offer.id, expiresAt } });
  return { row, settings: s, code };
}

/** FR-10.1: sending the offer sends the acceptance OTP and moves the case to S5. */
export async function sendOfferOtp(ctx: RequestContext, offerId: string, ifMatch: number | null, idempotencyKey: string) {
  const offer = (await ctx.tx.select().from(schema.offers).where(and(eq(schema.offers.tenantId, ctx.auth.tenantId), eq(schema.offers.id, offerId))).limit(1))[0];
  if (!offer) throw errors.notFound("Offer");
  const c = await lockCase(ctx, offer.caseId, ifMatch);
  if (!["S4", "S5"].includes(c.stage)) throw errors.gate("stage", `Offer is sent at S4 (case is at ${c.stage})`);
  if (!["DRAFT", "SENT"].includes(offer.status)) throw errors.gate("offer_live", `Offer v${offer.version} is ${offer.status}`);
  const q = (await ctx.tx.select().from(schema.quotes).where(eq(schema.quotes.id, offer.quoteId)).limit(1))[0];
  if (!q || q.status !== "ACTIVE") throw errors.gate("quote_active", "The offer's quote is no longer ACTIVE");
  if (q.validUntil < istDate(ctx.now)) throw errors.gate("quote_valid", `Quote v${q.version} expired on ${q.validUntil}`);
  if (!(await isEligible(ctx.tx, c))) throw errors.gate("eligible", "The case must be eligible with its financier before the offer is sent");
  if (q.provisional && !(await getSetting(c.tenantId, "gates.allow_provisional_quote_acceptance", ctx.tx))) throw errors.gate("provisional_quote", "Provisional quotes cannot be accepted (setting)");
  const dlt = (await getSetting(c.tenantId, "sms.dlt_template_acceptance", ctx.tx)) ?? "DLT-ACCEPTANCE-DEV";
  const content = offer.content as { totalInr: number; system: string };
  const { row, settings, code } = await issueOtp(ctx, c, offer, "ACCEPTANCE", idempotencyKey, (code, min) => `Your OTP to accept the offer (${content.system}, Rs ${content.totalInr.toLocaleString("en-IN")}) is ${code}. Valid ${min} min. Financing through Ecofy, subject to sanction. - iTarang`, String(dlt));
  if (offer.status === "DRAFT") await ctx.tx.update(schema.offers).set({ status: "SENT", sentAt: ctx.now }).where(eq(schema.offers.id, offer.id));
  if (c.stage === "S4") await transition(ctx, { caseId: c.id, expectedVersion: c.version, to: "S5", subStatus: "OTP_SENT", reason: `Offer v${offer.version} sent`, auditAction: "offer.send" });
  else await touchCase(ctx, c.id, c.version, {}, { action: "otp.resend", after: { offerId: offer.id } });
  return otpOut(row, settings.maxAttempts, settings.resendAfter, code);
}

export type FileRow = typeof schema.files.$inferSelect;

export async function fileOut(tx: Tx, f: FileRow) {
  const acc = await tx.select().from(schema.fileAcceptances).where(eq(schema.fileAcceptances.fileId, f.id)).orderBy(schema.fileAcceptances.acceptedAt);
  const q = (await tx.select({ provisional: schema.quotes.provisional, provisionalReason: schema.quotes.provisionalReason, systemDesc: schema.quotes.systemDesc }).from(schema.quotes).where(eq(schema.quotes.id, f.acceptedQuoteId)).limit(1))[0];
  return { id: f.id, caseId: f.caseId, fileNo: f.fileNo, acceptedQuoteId: f.acceptedQuoteId, quoteVersion: f.quoteVersion, acceptedTotalInr: f.acceptedTotalInr, method: f.method, acceptedAt: f.acceptedAt, provisional: q?.provisional ?? false, provisionalReason: q?.provisionalReason ?? null, system: q?.systemDesc ?? null, acceptances: acc.map((a) => ({ id: a.id, kind: a.kind, offerId: a.offerId, acceptedAt: a.acceptedAt })) };
}

/**
 * FR-10.2 … FR-10.5: verify the OTP. ACCEPTANCE → File created and locked (S5 → S6, financing attempt 1 SUBMITTED).
 * REACCEPTANCE → REVISED acceptance on the same File (S6 → S7 when the sanction is recorded).
 */
export async function verifyOtp(ctx: RequestContext, challengeId: string, code: string) {
  const ch = (await ctx.tx.select().from(schema.otpChallenges).where(and(eq(schema.otpChallenges.tenantId, ctx.auth.tenantId), eq(schema.otpChallenges.id, challengeId))).limit(1))[0];
  if (!ch) throw errors.notFound("OTP challenge");
  const c = await lockCase(ctx, ch.caseId, null);
  const s = await otpSettings(c.tenantId, ctx.tx);
  if (ch.status === "VERIFIED") return finishAfterVerify(ctx, c, ch, true);
  if (ch.status === "LOCKED") throw errors.rateLimited("This OTP is locked after too many wrong attempts; send a new one");
  if (ch.status !== "SENT") throw errors.validation(`OTP is ${ch.status}; send a new one`);
  if (new Date(ch.expiresAt) < ctx.now) {
    await ctx.tx.update(schema.otpChallenges).set({ status: "EXPIRED" }).where(eq(schema.otpChallenges.id, ch.id));
    throw errors.validation("OTP expired; send a new one");
  }
  if (hashCode(code) !== ch.codeHash) {
    const attempts = ch.attempts + 1;
    const locked = attempts >= s.maxAttempts;
    // the request transaction rolls back on the thrown error, so the failed attempt is persisted on its own
    await withDbContext({ tenantId: c.tenantId, userId: ctx.auth.userId, role: ctx.auth.role }, async (tx) => {
      await tx.update(schema.otpChallenges).set({ attempts: Math.min(attempts, 5), status: locked ? "LOCKED" : "SENT" }).where(eq(schema.otpChallenges.id, ch.id));
      const sctx = { ...ctx, tx };
      await audit(sctx, { action: "otp.failed", entityType: "otp_challenge", entityId: ch.id, caseId: c.id, after: { attempts, locked } });
      await emit(sctx, "otp.failed", ch.id, { caseId: c.id, attempts, locked });
    });
    if (locked) throw errors.rateLimited(`OTP locked after ${s.maxAttempts} wrong codes; send a new one`);
    throw errors.validation("Wrong OTP", { attemptsRemaining: s.maxAttempts - attempts });
  }
  await ctx.tx.update(schema.otpChallenges).set({ status: "VERIFIED", verifiedAt: ctx.now, attempts: ch.attempts + 1 }).where(eq(schema.otpChallenges.id, ch.id));
  await audit(ctx, { action: "otp.verified", entityType: "otp_challenge", entityId: ch.id, caseId: c.id, after: { purpose: ch.purpose } });
  await emit(ctx, "otp.verified", ch.id, { caseId: c.id, purpose: ch.purpose });
  return finishAfterVerify(ctx, c, ch, false);
}

async function finishAfterVerify(ctx: RequestContext, c: CaseRow, ch: OtpRow, replay: boolean) {
  const existingFile = (await ctx.tx.select().from(schema.files).where(eq(schema.files.caseId, c.id)).limit(1))[0];
  if (ch.purpose === "ACCEPTANCE") {
    if (existingFile) return fileOut(ctx.tx, existingFile); // idempotent replay
    const offer = (await ctx.tx.select().from(schema.offers).where(eq(schema.offers.id, ch.offerId)).limit(1))[0];
    const q = (await ctx.tx.select().from(schema.quotes).where(eq(schema.quotes.id, offer.quoteId)).limit(1))[0];
    const fileNo = `FL-${c.caseNo.replace(/^ECF-/, "")}`;
    const total = q.totalInr ?? q.equipmentInr + q.installationInr + q.gstInr;
    const file = (await ctx.tx.insert(schema.files).values({ tenantId: c.tenantId, fileNo, caseId: c.id, acceptedQuoteId: q.id, quoteVersion: q.version, acceptedTotalInr: total, method: "SMS_OTP", otpChallengeId: ch.id, acceptedAt: ctx.now }).returning())[0];
    await ctx.tx.insert(schema.fileAcceptances).values({ tenantId: c.tenantId, caseId: c.id, fileId: file.id, kind: "INITIAL", offerId: offer.id, otpChallengeId: ch.id, acceptedAt: ctx.now });
    await ctx.tx.update(schema.quotes).set({ status: "ACCEPTED" }).where(eq(schema.quotes.id, q.id));
    await ctx.tx.update(schema.offers).set({ status: "ACCEPTED" }).where(eq(schema.offers.id, offer.id));
    if (!c.financierId) throw errors.internal("case has no financier");
    await ctx.tx.insert(schema.financingDecisions).values({ tenantId: c.tenantId, caseId: c.id, fileId: file.id, financierId: c.financierId, attemptNo: 1, status: "SUBMITTED", submittedAt: ctx.now });
    const fin = await financierById(ctx.tx, c.tenantId, c.financierId);
    await transition(ctx, { caseId: c.id, expectedVersion: null, to: "S6", subStatus: "AWAITING_DECISION", reason: `File ${fileNo} locked`, auditAction: "file.lock" });
    await audit(ctx, { action: "file.create", entityType: "file", entityId: file.id, caseId: c.id, after: { fileNo, acceptedQuoteId: q.id, quoteVersion: q.version, acceptedTotalInr: total, provisional: q.provisional } });
    await emit(ctx, "file.locked", file.id, {
      caseId: c.id, fileNo, quoteId: q.id, quoteVersion: q.version, offerId: offer.id, documentId: q.documentId,
      notify: [{ role: fin.valuesVisibleTo as Role, type: "file.locked", title: `File ${fileNo} on ${c.caseNo} awaits a financing decision${q.provisional ? " (provisional quote)" : ""}`, caseId: c.id }],
    });
    return fileOut(ctx.tx, file);
  }
  // REACCEPTANCE (M11 FR-11.3, FR-10.6)
  if (!existingFile) throw errors.internal("re-acceptance without a File");
  const already = (await ctx.tx.select().from(schema.fileAcceptances).where(eq(schema.fileAcceptances.otpChallengeId, ch.id)).limit(1))[0];
  if (!already && !replay) {
    await ctx.tx.insert(schema.fileAcceptances).values({ tenantId: c.tenantId, caseId: c.id, fileId: existingFile.id, kind: "REVISED", offerId: ch.offerId, otpChallengeId: ch.id, acceptedAt: ctx.now });
    await audit(ctx, { action: "file.reaccept", entityType: "file", entityId: existingFile.id, caseId: c.id, after: { otpChallengeId: ch.id } });
    const sanctioned = (await ctx.tx.select({ id: schema.financingDecisions.id }).from(schema.financingDecisions).where(and(eq(schema.financingDecisions.caseId, c.id), eq(schema.financingDecisions.status, "SANCTIONED"))).orderBy(desc(schema.financingDecisions.attemptNo)).limit(1))[0];
    if (c.stage === "S6" && sanctioned) {
      await transition(ctx, { caseId: c.id, expectedVersion: null, to: "S7", subStatus: "INSTALLING", reason: "Revised acceptance verified", auditAction: "case.reaccepted" });
    }
    await emit(ctx, "otp.verified", ch.id, { caseId: c.id, purpose: "REACCEPTANCE", notify: [{ role: "ECOFY_ADMIN", type: "reacceptance.verified", title: `${c.caseNo}: customer re-accepted the revised amount`, caseId: c.id }] });
  }
  return fileOut(ctx.tx, existingFile);
}

export async function getFile(ctx: RequestContext, fileId: string) {
  const f = (await ctx.tx.select().from(schema.files).where(and(eq(schema.files.tenantId, ctx.auth.tenantId), eq(schema.files.id, fileId))).limit(1))[0];
  if (!f) throw errors.notFound("File");
  await requireCase(ctx, f.caseId);
  return fileOut(ctx.tx, f);
}

export async function fileOfCase(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const f = (await ctx.tx.select().from(schema.files).where(eq(schema.files.caseId, c.id)).limit(1))[0];
  return f ? fileOut(ctx.tx, f) : null;
}

/**
 * FR-11.3: the live (SENT) re-acceptance challenge of a case, or null. Lets the iTarang caller's Offer tab find the
 * challenge that Ecofy Admin triggered from the Financing tab, so the customer's code can be verified at S6.
 * Never carries the code: the plaintext exists only in the trigger response (devCode, sandbox) and the SMS.
 */
export async function liveReacceptanceChallenge(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const ch = (await ctx.tx.select().from(schema.otpChallenges).where(and(eq(schema.otpChallenges.caseId, c.id), eq(schema.otpChallenges.purpose, "REACCEPTANCE"), eq(schema.otpChallenges.status, "SENT"))).orderBy(desc(schema.otpChallenges.sentAt)).limit(1))[0];
  if (!ch) return null;
  const s = await otpSettings(c.tenantId, ctx.tx);
  return otpOut(ch, s.maxAttempts, s.resendAfter);
}

export async function otpStatus(ctx: RequestContext, challengeId: string) {
  const ch = (await ctx.tx.select().from(schema.otpChallenges).where(and(eq(schema.otpChallenges.tenantId, ctx.auth.tenantId), eq(schema.otpChallenges.id, challengeId))).limit(1))[0];
  if (!ch) throw errors.notFound("OTP challenge");
  await requireCase(ctx, ch.caseId);
  const s = await otpSettings(ch.tenantId, ctx.tx);
  return otpOut(ch, s.maxAttempts, s.resendAfter);
}

void sql;
