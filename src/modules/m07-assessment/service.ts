import { and, eq, desc, max } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { transition, lockCase, touchCase } from "@/core/state-engine/transition";
import type { RequestContext } from "@/core/http/context";
import { requireCase } from "@/modules/m04-qualify/service";
import { caseOut } from "@/modules/m04-qualify/caseView";
import { loadReleaseBundle, publishedRelease } from "@/modules/m08-calc-designer/releaseRepo";
import { runCalculator, manualStatus, type CalcResult, type RecoStatus } from "./calculator/engine";
import type { CalcInputT, AssessmentCreateT } from "./schemas";
import { verbatim } from "@/core/http/serialize";

export type AssessmentRow = typeof schema.assessments.$inferSelect;

/** FR-07.1: quick estimate on the PUBLISHED release, never stored. */
export async function estimate(ctx: RequestContext, input: CalcInputT) {
  const pub = await publishedRelease(ctx.tx, ctx.auth.tenantId);
  if (!pub) throw errors.gate("calculator_release", "No calculator release is published yet");
  const b = await loadReleaseBundle(ctx.tx, ctx.auth.tenantId, pub.id);
  return calcOut(runCalculator(b.params, b.appliances, b.systems, input, b.release.version));
}

/** CalcSteps keys are snake_case by contract (OpenAPI): keep them verbatim through serialisation. */
export function calcOut(r: CalcResult) {
  return { ...r, steps: verbatim(r.steps) };
}

export function assessmentOut(a: AssessmentRow) {
  const outputs = (a.outputs ?? {}) as Partial<CalcResult> & Record<string, unknown>;
  return {
    id: a.id, caseId: a.caseId, version: a.version, method: a.method, releaseId: a.releaseId, inputs: verbatim(a.inputs), result: { ...outputs, steps: verbatim(outputs.steps ?? {}) },
    recommendationStatus: a.recommendationStatus, recommendedCode: a.recommendedCode, selectedCode: a.selectedCode, overrideReason: a.overrideReason,
    confirmedBy: a.confirmedBy, confirmedAt: a.confirmedAt, createdBy: a.createdBy, createdAt: a.createdAt,
  };
}

export async function listAssessments(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const rows = await ctx.tx.select().from(schema.assessments).where(eq(schema.assessments.caseId, c.id)).orderBy(desc(schema.assessments.version));
  return rows.map(assessmentOut);
}

/**
 * FR-07.2 … FR-07.9: save a versioned assessment (calculator or manual/EPC). C&I never uses the calculator.
 * Override of the recommendation needs a reason (earned rule 4); PENDING never collapses into CUSTOM (earned rule 2).
 */
export async function saveAssessment(ctx: RequestContext, caseId: string, input: AssessmentCreateT) {
  const c = await requireCase(ctx, caseId);
  const role = ctx.auth.role;
  if (c.stage === "CLOSED") throw errors.gate("stage", "Closed cases accept no assessments");
  if (role === "ECOFY_USER" && c.stage !== "S0") throw errors.forbidden("Ecofy Users save assessments at S0 only");
  if (c.segment === "CI" && input.method === "CALCULATOR") throw errors.validation("The calculator is off for C&I; use MANUAL or EPC (EPC quote required)");

  let releaseId: string | null = null;
  let status: RecoStatus;
  let recommendedCode: string | null = null;
  let outputs: Record<string, unknown> = {};
  let inputs: Record<string, unknown> = {};
  if (input.method === "CALCULATOR") {
    if (!input.calculator) throw errors.validation("calculator input is required for CALCULATOR");
    if (input.calculator.segment !== c.segment) throw errors.validation(`calculator segment must be the case segment (${c.segment})`);
    const pub = await publishedRelease(ctx.tx, c.tenantId);
    if (!pub) throw errors.gate("calculator_release", "No calculator release is published yet");
    const b = await loadReleaseBundle(ctx.tx, c.tenantId, pub.id);
    const result = runCalculator(b.params, b.appliances, b.systems, input.calculator, b.release.version);
    releaseId = pub.id;
    status = result.recommendationStatus;
    recommendedCode = result.options.find((o) => o.role === "RECOMMENDED")?.systemCode ?? null;
    outputs = result as unknown as Record<string, unknown>;
    inputs = input.calculator;
  } else {
    if (!input.manual) throw errors.validation("manual sizes are required for MANUAL/EPC");
    status = manualStatus(input.manual);
    inputs = { ...input.manual, method: input.method };
    outputs = { steps: { battery_size_kwh: input.manual.batteryKwh ?? null, required_inverter_kva: input.manual.inverterKva ?? null, solar_kwp: input.manual.solarKwp ?? null }, recommendationStatus: status, options: [] };
  }
  let selectedCode: string | null = input.selectedSystemCode ?? recommendedCode;
  let overrideReason: string | null = null;
  if (selectedCode && recommendedCode && selectedCode !== recommendedCode) {
    if (!input.overrideReason) throw errors.validation("overrideReason is required when the selected system differs from the recommendation");
    overrideReason = input.overrideReason;
  }
  if (selectedCode && !recommendedCode && status !== "RECOMMENDED") {
    // choosing a system when nothing was recommended is also an override that needs a reason
    if (!input.overrideReason) throw errors.validation("overrideReason is required when selecting a system without a recommendation");
    overrideReason = input.overrideReason;
  }
  if (!selectedCode) selectedCode = null;
  const last = (await ctx.tx.select({ v: max(schema.assessments.version) }).from(schema.assessments).where(eq(schema.assessments.caseId, c.id)))[0]?.v ?? 0;
  const row = (await ctx.tx.insert(schema.assessments).values({
    tenantId: c.tenantId, caseId: c.id, version: Number(last) + 1, method: input.method, releaseId, inputs, outputs, recommendationStatus: status, recommendedCode, selectedCode, overrideReason, createdBy: ctx.auth.userId, createdAt: ctx.now,
  }).returning())[0];
  await audit(ctx, { action: "assessment.save", entityType: "assessment", entityId: row.id, caseId: c.id, after: { version: row.version, method: input.method, recommendationStatus: status, recommendedCode, selectedCode, overrideReason }, reason: overrideReason });
  await emit(ctx, "assessment.saved", row.id, { caseId: c.id, version: row.version, recommendationStatus: status });
  await touchCase(ctx, c.id, null, {}, { action: "assessment.saved", after: { assessmentId: row.id }, bump: false });
  return assessmentOut(row);
}

/** FR-07.10: confirming an assessment closes S3 (S3 → S4). An S0 Ecofy run can be confirmed in one click. */
export async function confirmAssessment(ctx: RequestContext, assessmentId: string, ifMatch: number | null) {
  const a = (await ctx.tx.select().from(schema.assessments).where(and(eq(schema.assessments.tenantId, ctx.auth.tenantId), eq(schema.assessments.id, assessmentId))).limit(1))[0];
  if (!a) throw errors.notFound("Assessment");
  const c = await lockCase(ctx, a.caseId, ifMatch);
  if (c.stage !== "S3") throw errors.gate("stage", `Assessment is confirmed at S3 (case is at ${c.stage})`);
  await ctx.tx.update(schema.assessments).set({ confirmedBy: ctx.auth.userId, confirmedAt: ctx.now }).where(eq(schema.assessments.id, a.id));
  const next = await transition(ctx, {
    caseId: c.id, expectedVersion: c.version, to: "S4", subStatus: "ELIGIBILITY_PENDING", reason: `Assessment v${a.version} confirmed`,
    gates: [{ name: "assessment_exists", check: () => (a ? null : "An assessment record is required") }],
    auditAction: "assessment.confirm",
  });
  await emit(ctx, "assessment.confirmed", a.id, { caseId: c.id, version: a.version });
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}

/** Latest assessment of a case (for quotes). */
export async function latestAssessment(ctx: RequestContext, caseId: string): Promise<AssessmentRow | null> {
  const r = await ctx.tx.select().from(schema.assessments).where(eq(schema.assessments.caseId, caseId)).orderBy(desc(schema.assessments.version)).limit(1);
  return r[0] ?? null;
}
