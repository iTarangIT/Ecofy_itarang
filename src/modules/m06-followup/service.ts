import { and, eq, asc, inArray } from "drizzle-orm";
import type { z } from "zod";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { getSetting } from "@/core/settings/settingsCache";
import { transition, lockCase, touchCase, type Gate } from "@/core/state-engine/transition";
import type { RequestContext } from "@/core/http/context";
import { requireCase } from "@/modules/m04-qualify/service";
import { caseOut } from "@/modules/m04-qualify/caseView";
import { assertListCode } from "@/modules/m02-settings/service";
import type { ActivityCreate, AppointmentCreate, AppointmentUpdate } from "./schemas";

// ------------------------------------------------------------------ activities (FR-04.2, FR-06.1, FR-05.4)
export async function listActivities(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const rows = await ctx.tx.select().from(schema.activities).where(eq(schema.activities.caseId, c.id)).orderBy(asc(schema.activities.at), asc(schema.activities.id));
  const ids = [...new Set(rows.map((r) => r.actorId).filter((x): x is string => Boolean(x)))];
  const users = ids.length ? await ctx.tx.select({ id: schema.users.id, fullName: schema.users.fullName, role: schema.users.role }).from(schema.users).where(inArray(schema.users.id, ids)) : [];
  const umap = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ id: Number(r.id), type: r.type, callOutcome: r.callOutcome, note: r.note, nextFollowUpAt: r.nextFollowUpAt, at: r.at, actor: r.actorId ? umap.get(r.actorId) ?? null : null }));
}

export async function logActivity(ctx: RequestContext, caseId: string, input: z.infer<typeof ActivityCreate>) {
  const c = await requireCase(ctx, caseId);
  const role = ctx.auth.role;
  if (c.stage === "CLOSED") throw errors.gate("stage", "Closed cases accept no activities");
  // FR-04.5: after handoff Ecofy users may comment only
  const ecofy = role === "ECOFY_ADMIN" || role === "ECOFY_USER";
  if (ecofy && c.stage !== "S0" && input.type !== "COMMENT") throw errors.forbidden("After handoff Ecofy users can add comments only");
  if (role === "ECOFY_ADMIN" && input.type !== "COMMENT") throw errors.forbidden("Ecofy Admin can add comments only");
  if (input.type === "CALL" && !input.callOutcome) throw errors.validation("callOutcome is required for CALL");
  if (input.type === "FOLLOW_UP" && !input.nextFollowUpAt) throw errors.validation("nextFollowUpAt is required for FOLLOW_UP");
  const row = (await ctx.tx.insert(schema.activities).values({ tenantId: c.tenantId, caseId: c.id, type: input.type, callOutcome: input.callOutcome ?? null, note: input.note ?? null, nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null, actorId: ctx.auth.userId, at: ctx.now }).returning())[0];
  // FR-05.4: time from Hot to the caller's first call
  if (input.type === "CALL" && !c.firstCallAt && (role === "ITARANG_CALLER" || role === "ITARANG_ADMIN") && c.stage !== "S0") {
    await touchCase(ctx, c.id, null, { firstCallAt: ctx.now }, { action: "case.first_call", after: { firstCallAt: ctx.now }, bump: false });
  } else {
    await touchCase(ctx, c.id, null, {}, { action: "activity.logged", after: { type: input.type, activityId: Number(row.id) }, bump: false });
  }
  await emit(ctx, "activity.logged", c.id, { activityId: Number(row.id), type: input.type });
  return { id: Number(row.id), type: row.type, callOutcome: row.callOutcome, note: row.note, nextFollowUpAt: row.nextFollowUpAt, at: row.at };
}

// ------------------------------------------------------------------ appointments (FR-06.2 … FR-06.6)
export function appointmentOut(a: typeof schema.appointments.$inferSelect) {
  return { id: a.id, caseId: a.caseId, meetingType: a.meetingType, scheduledAt: a.scheduledAt, status: a.status, bookingRemarks: a.bookingRemarks, actualAt: a.actualAt, meetingRemarks: a.meetingRemarks, outcomeReason: a.outcomeReason, epcPartnerId: a.epcPartnerId, epcFeedback: a.epcFeedback, rescheduledFrom: a.rescheduledFrom, createdBy: a.createdBy, createdAt: a.createdAt };
}

export async function listAppointments(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const rows = await ctx.tx.select().from(schema.appointments).where(eq(schema.appointments.caseId, c.id)).orderBy(asc(schema.appointments.scheduledAt));
  return rows.map(appointmentOut);
}

export async function bookAppointment(ctx: RequestContext, caseId: string, input: z.infer<typeof AppointmentCreate>) {
  const c = await requireCase(ctx, caseId);
  if (c.stage === "CLOSED" || c.stage === "S0") throw errors.gate("stage", "Appointments are booked from S1");
  await assertListCode(ctx.tx, c.tenantId, "meeting_type", input.meetingType, "meetingType", true);
  if (input.meetingType === "EPC_VISIT") {
    if (!input.epcPartnerId) throw errors.validation("EPC_VISIT needs epcPartnerId");
    const p = (await ctx.tx.select({ id: schema.epcPartners.id }).from(schema.epcPartners).where(and(eq(schema.epcPartners.id, input.epcPartnerId), eq(schema.epcPartners.active, true))).limit(1))[0];
    if (!p) throw errors.validation("EPC partner not found or inactive");
  }
  const row = (await ctx.tx.insert(schema.appointments).values({ tenantId: c.tenantId, caseId: c.id, meetingType: input.meetingType, scheduledAt: new Date(input.scheduledAt), status: "SCHEDULED", bookingRemarks: input.bookingRemarks ?? null, epcPartnerId: input.epcPartnerId ?? null, createdBy: ctx.auth.userId, createdAt: ctx.now }).returning())[0];
  await audit(ctx, { action: "appointment.schedule", entityType: "appointment", entityId: row.id, caseId: c.id, after: appointmentOut(row) });
  await emit(ctx, "appointment.scheduled", row.id, { caseId: c.id, meetingType: input.meetingType, scheduledAt: input.scheduledAt });
  await touchCase(ctx, c.id, null, {}, { action: "appointment.scheduled", after: { appointmentId: row.id }, bump: false });
  return appointmentOut(row);
}

export async function updateAppointment(ctx: RequestContext, id: string, input: z.infer<typeof AppointmentUpdate>) {
  const a = (await ctx.tx.select().from(schema.appointments).where(and(eq(schema.appointments.tenantId, ctx.auth.tenantId), eq(schema.appointments.id, id))).limit(1))[0];
  if (!a) throw errors.notFound("Appointment");
  const c = await requireCase(ctx, a.caseId); // RLS scope
  if (input.action === "EPC_FEEDBACK") {
    if (a.meetingType !== "EPC_VISIT") throw errors.validation("EPC feedback applies to EPC visits");
    const row = (await ctx.tx.update(schema.appointments).set({ epcFeedback: input.epcFeedback ?? null }).where(eq(schema.appointments.id, a.id)).returning())[0];
    await audit(ctx, { action: "appointment.epc_feedback", entityType: "appointment", entityId: a.id, caseId: c.id, after: { epcFeedback: input.epcFeedback } });
    return appointmentOut(row);
  }
  if (a.status !== "SCHEDULED") throw errors.validation(`Appointment is ${a.status}`);
  if (input.action === "RESCHEDULE") {
    if (!input.scheduledAt) throw errors.validation("scheduledAt is required to reschedule");
    await ctx.tx.update(schema.appointments).set({ status: "RESCHEDULED" }).where(eq(schema.appointments.id, a.id));
    const row = (await ctx.tx.insert(schema.appointments).values({ tenantId: a.tenantId, caseId: a.caseId, meetingType: a.meetingType, scheduledAt: new Date(input.scheduledAt), status: "SCHEDULED", bookingRemarks: a.bookingRemarks, epcPartnerId: a.epcPartnerId, rescheduledFrom: a.id, createdBy: ctx.auth.userId, createdAt: ctx.now }).returning())[0];
    await audit(ctx, { action: "appointment.reschedule", entityType: "appointment", entityId: row.id, caseId: c.id, before: { scheduledAt: a.scheduledAt }, after: { scheduledAt: input.scheduledAt, rescheduledFrom: a.id } });
    await emit(ctx, "appointment.scheduled", row.id, { caseId: c.id, meetingType: a.meetingType, scheduledAt: input.scheduledAt, rescheduledFrom: a.id });
    return appointmentOut(row);
  }
  if (input.action === "COMPLETE") {
    if (!input.actualAt || !input.meetingRemarks) throw errors.validation("COMPLETE needs actualAt and meetingRemarks");
    const row = (await ctx.tx.update(schema.appointments).set({ status: "COMPLETED", actualAt: new Date(input.actualAt), meetingRemarks: input.meetingRemarks, epcFeedback: input.epcFeedback ?? a.epcFeedback }).where(eq(schema.appointments.id, a.id)).returning())[0];
    await audit(ctx, { action: "appointment.complete", entityType: "appointment", entityId: a.id, caseId: c.id, after: { actualAt: input.actualAt, meetingRemarks: input.meetingRemarks } });
    await emit(ctx, "appointment.completed", a.id, { caseId: c.id, meetingType: a.meetingType });
    await touchCase(ctx, c.id, null, {}, { action: "appointment.completed", after: { appointmentId: a.id }, bump: false });
    return appointmentOut(row);
  }
  // NO_SHOW / CANCEL
  if (!input.outcomeReason) throw errors.validation(`${input.action} needs outcomeReason`);
  const status = input.action === "NO_SHOW" ? "NO_SHOW" : "CANCELLED";
  const row = (await ctx.tx.update(schema.appointments).set({ status, outcomeReason: input.outcomeReason }).where(eq(schema.appointments.id, a.id)).returning())[0];
  await audit(ctx, { action: `appointment.${status.toLowerCase()}`, entityType: "appointment", entityId: a.id, caseId: c.id, after: { outcomeReason: input.outcomeReason } });
  return appointmentOut(row);
}

// ------------------------------------------------------------------ S2 → S3 (FR-06.7)
export function meetingGate(ctx: RequestContext): Gate {
  return {
    name: "meeting_before_assessment",
    check: async (c) => {
      const on = await getSetting(c.tenantId, "gates.meeting_before_assessment", ctx.tx);
      if (!on) return null;
      const done = (await ctx.tx.select({ id: schema.appointments.id }).from(schema.appointments).where(and(eq(schema.appointments.caseId, c.id), eq(schema.appointments.status, "COMPLETED"))).limit(1))[0];
      return done ? null : "At least one completed meeting or EPC visit is required before assessment";
    },
  };
}

export async function advanceToAssessment(ctx: RequestContext, caseId: string, ifMatch: number | null) {
  const c = await lockCase(ctx, caseId, ifMatch);
  if (c.stage !== "S2") throw errors.gate("stage", `Advance to assessment applies at S2 (case is at ${c.stage})`);
  const next = await transition(ctx, { caseId: c.id, expectedVersion: c.version, to: "S3", gates: [meetingGate(ctx)], reason: "Advanced to assessment", auditAction: "case.advance" });
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}
