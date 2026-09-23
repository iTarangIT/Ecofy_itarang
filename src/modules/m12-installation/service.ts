import { and, eq, desc } from "drizzle-orm";
import type { z } from "zod";
import { schema, type Tx } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { getSetting } from "@/core/settings/settingsCache";
import { transition, lockCase, touchCase } from "@/core/state-engine/transition";
import type { RequestContext } from "@/core/http/context";
import type { Role } from "@/core/auth/rbac";
import { requireCase } from "@/modules/m04-qualify/service";
import { caseOut } from "@/modules/m04-qualify/caseView";
import { financierById } from "@/modules/m02-settings/service";
import { countDocuments } from "@/modules/m15-documents/service";
import { latestSanction } from "@/modules/m11-financing/service";
import type { InstallationCreate, InstallationUpdate, DownPayment, Disbursement } from "./schemas";

export type InstallationRow = typeof schema.installations.$inferSelect;
const ORDER = ["NOT_STARTED", "SCHEDULED", "IN_PROGRESS", "INSTALLED", "COMMISSIONED"] as const;

export async function installationOut(tx: Tx, i: InstallationRow) {
  const events = await tx.select().from(schema.installationEvents).where(eq(schema.installationEvents.installationId, i.id)).orderBy(schema.installationEvents.at);
  const p = (await tx.select({ name: schema.epcPartners.name }).from(schema.epcPartners).where(eq(schema.epcPartners.id, i.epcPartnerId)).limit(1))[0];
  return { id: i.id, caseId: i.caseId, epcPartnerId: i.epcPartnerId, epcPartnerName: p?.name ?? null, status: i.status, scheduledOn: i.scheduledOn, startedOn: i.startedOn, completedOn: i.completedOn, startedBeforeSanction: i.startedBeforeSanction, stopReason: i.stopReason, updatedBy: i.updatedBy, updatedAt: i.updatedAt, events: events.map((e) => ({ id: Number(e.id), status: e.status, note: e.note, actorId: e.actorId, at: e.at })) };
}

export async function getInstallation(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const i = (await ctx.tx.select().from(schema.installations).where(eq(schema.installations.caseId, c.id)).limit(1))[0];
  return i ? installationOut(ctx.tx, i) : null;
}

/** FR-12.1: created at S6/S7 with an EPC partner; NOT_STARTED, or SCHEDULED when a date is given (OpenAPI lacks NOT_STARTED). */
export async function createInstallation(ctx: RequestContext, caseId: string, input: z.infer<typeof InstallationCreate>) {
  const c = await requireCase(ctx, caseId);
  if (!["S6", "S7"].includes(c.stage)) throw errors.gate("stage", "Installation is created at S6 or S7 (after the File)");
  const p = (await ctx.tx.select({ id: schema.epcPartners.id, active: schema.epcPartners.active }).from(schema.epcPartners).where(and(eq(schema.epcPartners.tenantId, c.tenantId), eq(schema.epcPartners.id, input.epcPartnerId))).limit(1))[0];
  if (!p || !p.active) throw errors.validation("EPC partner not found or inactive");
  const existing = (await ctx.tx.select().from(schema.installations).where(eq(schema.installations.caseId, c.id)).limit(1))[0];
  if (existing) throw errors.validation("The case already has an installation");
  const status = input.scheduledOn ? "SCHEDULED" : "NOT_STARTED";
  const row = (await ctx.tx.insert(schema.installations).values({ tenantId: c.tenantId, caseId: c.id, epcPartnerId: input.epcPartnerId, status, scheduledOn: input.scheduledOn ?? null, updatedBy: ctx.auth.userId, updatedAt: ctx.now }).returning())[0];
  await ctx.tx.insert(schema.installationEvents).values({ tenantId: c.tenantId, installationId: row.id, status, note: "Installation created", actorId: ctx.auth.userId, at: ctx.now });
  await audit(ctx, { action: "installation.create", entityType: "installation", entityId: row.id, caseId: c.id, after: { status, epcPartnerId: input.epcPartnerId, scheduledOn: input.scheduledOn ?? null } });
  await emit(ctx, "installation.status_changed", row.id, { caseId: c.id, status });
  await touchCase(ctx, c.id, null, {}, { action: "installation.created", after: { installationId: row.id }, bump: false });
  return installationOut(ctx.tx, row);
}

/**
 * FR-12.2, FR-12.3, BRD 4.3: a separate state machine. Starting before sanction needs an acknowledgement
 * (audited) while gates.sanction_before_installation is off; INSTALLED needs ≥1 photo + the acceptance letter.
 */
export async function updateInstallation(ctx: RequestContext, installationId: string, input: z.infer<typeof InstallationUpdate>) {
  const i = (await ctx.tx.select().from(schema.installations).where(and(eq(schema.installations.tenantId, ctx.auth.tenantId), eq(schema.installations.id, installationId))).limit(1))[0];
  if (!i) throw errors.notFound("Installation");
  const c = await lockCase(ctx, i.caseId, null);
  if (i.status === "STOPPED") throw errors.validation("A STOPPED installation cannot change state");
  const target = input.status;
  const set: Partial<typeof schema.installations.$inferInsert> = { status: target, updatedBy: ctx.auth.userId, updatedAt: ctx.now };
  let startedBeforeSanction = i.startedBeforeSanction;
  if (target === "STOPPED") {
    if (!input.stopReason) throw errors.validation("stopReason is required for STOPPED");
    set.stopReason = input.stopReason;
  } else {
    if (ORDER.indexOf(target) <= ORDER.indexOf(i.status as (typeof ORDER)[number])) throw errors.validation(`Installation is already ${i.status}`);
    const sanction = await latestSanction(ctx.tx, c.id);
    if (target === "IN_PROGRESS" || (target === "INSTALLED" && i.status !== "IN_PROGRESS")) {
      if (!sanction) {
        const gate = await getSetting(c.tenantId, "gates.sanction_before_installation", ctx.tx);
        if (gate) throw errors.gate("sanction_before_installation", "Installation cannot start before the sanction is recorded (setting gates.sanction_before_installation)");
        if (!input.acknowledgeNoSanction) throw errors.gate("acknowledge_no_sanction", "No sanction is recorded yet: confirm with acknowledgeNoSanction=true to start anyway (warning)");
        startedBeforeSanction = true;
        set.startedBeforeSanction = true;
      }
      const dpGate = await getSetting(c.tenantId, "gates.down_payment_before_installation", ctx.tx);
      if (dpGate) {
        const dp = (await ctx.tx.select({ id: schema.downPayments.id }).from(schema.downPayments).where(eq(schema.downPayments.caseId, c.id)).limit(1))[0];
        // the caller's role may not see the row (RLS); check existence through the audit trail written by the financier's role
        const audited = dp ? true : (await ctx.tx.select({ id: schema.auditLog.id }).from(schema.auditLog).where(and(eq(schema.auditLog.caseId, c.id), eq(schema.auditLog.action, "downpayment.record"))).limit(1))[0];
        if (!audited) throw errors.gate("down_payment_before_installation", "A down payment must be recorded before installation starts (setting gates.down_payment_before_installation)");
      }
      if (target === "IN_PROGRESS") set.startedOn = input.onDate ?? null;
    }
    if (target === "SCHEDULED") set.scheduledOn = input.onDate ?? i.scheduledOn;
    if (target === "INSTALLED" || target === "COMMISSIONED") {
      const photos = await countDocuments(ctx, c.id, "INSTALLATION_PHOTO");
      const letters = await countDocuments(ctx, c.id, "CUSTOMER_ACCEPTANCE_LETTER");
      if (photos < 1 || letters < 1) throw errors.gate("installation_proof", `INSTALLED needs at least one INSTALLATION_PHOTO and a CUSTOMER_ACCEPTANCE_LETTER on the case (photos: ${photos}, letters: ${letters})`);
      set.completedOn = input.onDate ?? i.completedOn ?? null;
      if (!set.startedOn && !i.startedOn) set.startedOn = input.onDate ?? null;
    }
  }
  const row = (await ctx.tx.update(schema.installations).set(set).where(eq(schema.installations.id, i.id)).returning())[0];
  await ctx.tx.insert(schema.installationEvents).values({ tenantId: c.tenantId, installationId: i.id, status: target, note: input.note ?? (target === "STOPPED" ? input.stopReason ?? null : null), actorId: ctx.auth.userId, at: ctx.now });
  await audit(ctx, { action: "installation.status", entityType: "installation", entityId: i.id, caseId: c.id, before: { status: i.status }, after: { status: target, startedBeforeSanction, acknowledgeNoSanction: Boolean(input.acknowledgeNoSanction) }, reason: input.stopReason ?? input.note ?? null });
  await emit(ctx, "installation.status_changed", i.id, {
    caseId: c.id, status: target, startedBeforeSanction,
    notify: startedBeforeSanction && !i.startedBeforeSanction ? [{ role: "ITARANG_ADMIN", type: "installation.before_sanction", title: `${c.caseNo}: installation started before sanction (acknowledged)`, caseId: c.id }] : [],
  });
  if (c.stage === "S7" && (target === "INSTALLED" || target === "COMMISSIONED")) await transition(ctx, { caseId: c.id, expectedVersion: null, to: "S7", subStatus: "INSTALLED", reason: `Installation ${target}`, auditAction: "installation.installed" });
  else await touchCase(ctx, c.id, null, {}, { action: "installation.status", after: { status: target }, bump: false });
  return installationOut(ctx.tx, row);
}

// ------------------------------------------------------------------ down payment (FR-12.4)
async function assertFinancierRole(ctx: RequestContext, c: { tenantId: string; financierId: string | null }) {
  if (!c.financierId) throw errors.validation("The case has no financier");
  const fin = await financierById(ctx.tx, c.tenantId, c.financierId);
  if (fin.valuesVisibleTo !== ctx.auth.role) throw errors.forbidden(`Only ${fin.valuesVisibleTo} records amounts for ${fin.name}`);
  return fin;
}

export async function recordDownPayment(ctx: RequestContext, caseId: string, input: z.infer<typeof DownPayment>) {
  const c = await requireCase(ctx, caseId);
  if (!["S6", "S7"].includes(c.stage)) throw errors.gate("stage", "Down payment is recorded at S6 or S7");
  const fin = await assertFinancierRole(ctx, c);
  const row = (await ctx.tx.insert(schema.downPayments).values({ tenantId: c.tenantId, caseId: c.id, visibleTo: fin.valuesVisibleTo as Role, receivedOn: input.receivedOn, amountInr: input.amountInr, reference: input.reference ?? null, recordedBy: ctx.auth.userId, recordedAt: ctx.now }).returning())[0];
  await audit(ctx, { action: "downpayment.record", entityType: "down_payment", entityId: row.id, caseId: c.id, after: { receivedOn: input.receivedOn } });
  await emit(ctx, "downpayment.recorded", row.id, { caseId: c.id, notify: [{ role: "ITARANG_ADMIN", type: "downpayment.recorded", title: `${c.caseNo}: down payment received (status)`, caseId: c.id }] });
  await touchCase(ctx, c.id, null, {}, { action: "downpayment.recorded", after: { id: row.id }, bump: false });
  return { id: row.id, caseId: c.id, receivedOn: row.receivedOn, amountInr: row.amountInr, reference: row.reference, recordedAt: row.recordedAt };
}

export async function listDownPayments(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const rows = await ctx.tx.select().from(schema.downPayments).where(eq(schema.downPayments.caseId, c.id)).orderBy(schema.downPayments.receivedOn); // RLS: only the financier's role sees rows
  return rows.map((r) => ({ id: r.id, receivedOn: r.receivedOn, amountInr: r.amountInr, reference: r.reference, recordedAt: r.recordedAt }));
}

/** Status-only view for roles that may not see amounts (down payment recorded or not). */
export async function paymentStatus(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const dp = (await ctx.tx.select({ id: schema.auditLog.id }).from(schema.auditLog).where(and(eq(schema.auditLog.caseId, c.id), eq(schema.auditLog.action, "downpayment.record"))).limit(1))[0];
  const disb = (await ctx.tx.select({ id: schema.auditLog.id }).from(schema.auditLog).where(and(eq(schema.auditLog.caseId, c.id), eq(schema.auditLog.action, "disbursement.record"))).limit(1))[0];
  return { downPaymentRecorded: Boolean(dp), disbursementRecorded: Boolean(disb) };
}

// ------------------------------------------------------------------ disbursement (FR-12.5) — S7 → S8, asset created (FR-13.1)
export async function recordDisbursement(ctx: RequestContext, caseId: string, ifMatch: number | null, input: z.infer<typeof Disbursement>) {
  const c = await lockCase(ctx, caseId, ifMatch);
  if (c.stage !== "S7") throw errors.gate("stage", `Disbursement is recorded at S7 (case is at ${c.stage})`);
  const fin = await assertFinancierRole(ctx, c);
  const sanction = await latestSanction(ctx.tx, c.id);
  if (!sanction) throw errors.gate("sanctioned", "A sanction must be recorded first");
  if (c.subStatus === "REACCEPTANCE_PENDING") throw errors.gate("reacceptance", "Re-acceptance is pending");
  const inst = (await ctx.tx.select().from(schema.installations).where(eq(schema.installations.caseId, c.id)).limit(1))[0];
  if (!inst || !["INSTALLED", "COMMISSIONED"].includes(inst.status)) throw errors.gate("installed", "Installation must be INSTALLED or COMMISSIONED");
  const photos = await countDocuments(ctx, c.id, "INSTALLATION_PHOTO");
  const letters = await countDocuments(ctx, c.id, "CUSTOMER_ACCEPTANCE_LETTER");
  if (photos < 1 || letters < 1) throw errors.gate("installation_proof", "Installation photos and the customer acceptance letter are required");
  const row = (await ctx.tx.insert(schema.disbursements).values({ tenantId: c.tenantId, caseId: c.id, decisionId: sanction.id, visibleTo: fin.valuesVisibleTo as Role, disbursedOn: input.disbursedOn, amountInr: input.amountInr, reference: input.reference ?? null, recordedBy: ctx.auth.userId, recordedAt: ctx.now }).returning())[0];
  await audit(ctx, { action: "disbursement.record", entityType: "disbursement", entityId: row.id, caseId: c.id, after: { disbursedOn: input.disbursedOn, decisionId: sanction.id } });
  // asset snapshot of the installed system (from the accepted quote + installation)
  const file = (await ctx.tx.select().from(schema.files).where(eq(schema.files.caseId, c.id)).limit(1))[0];
  const q = file ? (await ctx.tx.select().from(schema.quotes).where(eq(schema.quotes.id, file.acceptedQuoteId)).limit(1))[0] : null;
  const snapshot = { system: q?.systemDesc ?? null, batteryKwh: q?.batteryKwh ?? null, inverterKva: q?.inverterKva ?? null, solarKwp: q?.solarKwp ?? null, quoteVersion: file?.quoteVersion ?? null, epcPartnerId: inst.epcPartnerId, installedOn: inst.completedOn, fileNo: file?.fileNo ?? null };
  const asset = (await ctx.tx.insert(schema.assets).values({ tenantId: c.tenantId, caseId: c.id, systemSnapshot: snapshot, commissionedOn: inst.completedOn ?? input.disbursedOn, status: "ACTIVE", createdAt: ctx.now }).returning())[0];
  await audit(ctx, { action: "asset.activate", entityType: "asset", entityId: asset.id, caseId: c.id, after: snapshot });
  const next = await transition(ctx, { caseId: c.id, expectedVersion: c.version, to: "S8", subStatus: null, reason: "Disbursement recorded", auditAction: "disbursement.recorded" });
  await emit(ctx, "disbursement.recorded", row.id, { caseId: c.id, notify: [{ role: "ITARANG_ADMIN", type: "disbursement.recorded", title: `${c.caseNo}: payout recorded; asset active`, caseId: c.id }] });
  await emit(ctx, "asset.activated", asset.id, { caseId: c.id });
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}

export { desc };
