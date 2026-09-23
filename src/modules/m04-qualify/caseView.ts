import { and, eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/core/db/client";
import { loadCalendar } from "@/core/calendar/loadCalendar";
import { workingHoursBetween } from "@/core/calendar/workingHours";
import { getSetting } from "@/core/settings/settingsCache";
import { maskMobile } from "@/core/http/serialize";
import type { Role } from "@/core/auth/rbac";
import type { CaseRow } from "@/core/state-engine/transition";

export type CustomerRow = typeof schema.customers.$inferSelect;

/**
 * Case → API shape (OpenAPI `Case`, additionalProperties). Money never appears here.
 * `list` masks the mobile (FR-17.5, setting exports.mask_mobile_in_lists).
 */
export async function caseOut(tx: Tx, tenantId: string, role: Role, rows: CaseRow[], opts: { list?: boolean; now?: Date } = {}) {
  if (!rows.length) return [];
  const now = opts.now ?? new Date();
  const cal = await loadCalendar(tx, tenantId);
  const mask = opts.list ? Boolean(await getSetting(tenantId, "exports.mask_mobile_in_lists", tx)) : false;
  const customerIds = [...new Set(rows.map((r) => r.customerId))];
  const customers = await tx.select().from(schema.customers).where(inArray(schema.customers.id, customerIds));
  const cmap = new Map(customers.map((c) => [c.id, c]));
  const orgs = await tx.select().from(schema.orgs).where(eq(schema.orgs.tenantId, tenantId));
  const omap = new Map(orgs.map((o) => [o.id, o.kind]));
  const userIds = [...new Set(rows.flatMap((r) => [r.assignedUserId, r.qualifiedBy]).filter((x): x is string => Boolean(x)))];
  const users = userIds.length ? await tx.select({ id: schema.users.id, fullName: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, userIds)) : [];
  const umap = new Map(users.map((u) => [u.id, u.fullName]));
  const finIds = [...new Set(rows.map((r) => r.financierId).filter((x): x is string => Boolean(x)))];
  const fins = finIds.length ? await tx.select({ id: schema.financiers.id, name: schema.financiers.name }).from(schema.financiers).where(inArray(schema.financiers.id, finIds)) : [];
  const fmap = new Map(fins.map((f) => [f.id, f.name]));

  return rows.map((c) => {
    const cu = cmap.get(c.customerId);
    const inStage = workingHoursBetween(new Date(c.stageEnteredAt), now, cal);
    const open = workingHoursBetween(new Date(c.createdAt), c.closedAt ? new Date(c.closedAt) : now, cal);
    return {
      id: c.id,
      caseNo: c.caseNo,
      version: c.version,
      stage: c.stage,
      subStatus: c.subStatus,
      segment: c.segment,
      temperature: c.temperature,
      source: c.source,
      owner: omap.get(c.ownerOrgId) ?? "ECOFY",
      assignedUserId: c.assignedUserId,
      assignedUserName: c.assignedUserId ? umap.get(c.assignedUserId) ?? null : null,
      qualifiedBy: c.qualifiedBy,
      qualifiedByName: c.qualifiedBy ? umap.get(c.qualifiedBy) ?? null : null,
      financierId: c.financierId,
      financierName: c.financierId ? fmap.get(c.financierId) ?? null : null,
      customer: cu
        ? {
            id: cu.id,
            fullName: cu.fullName,
            mobile: mask ? maskMobile(cu.mobileE164) : cu.mobileE164,
            altMobile: mask ? maskMobile(cu.altMobileE164) : cu.altMobileE164,
            email: opts.list ? undefined : cu.email,
            customerType: cu.customerType,
            businessName: cu.businessName,
            address: opts.list ? undefined : cu.address,
            city: cu.city,
            state: cu.state,
            pincode: cu.pincode,
            preferredLanguage: cu.preferredLanguage,
            propertyType: cu.propertyType,
            consentDate: cu.consentDate,
            consentSource: cu.consentSource,
          }
        : null,
      productInterest: c.productInterest,
      avgMonthlyBillInr: c.avgMonthlyBillInr,
      sanctionedLoadKw: c.sanctionedLoadKw === null ? null : Number(c.sanctionedLoadKw),
      existingBackup: c.existingBackup,
      preferredCallTime: c.preferredCallTime,
      ecofyLeadId: c.ecofyLeadId,
      stageEnteredAt: c.stageEnteredAt,
      queueEnteredAt: c.queueEnteredAt,
      firstCallAt: c.firstCallAt,
      hotToFirstCallHours: c.queueEnteredAt && c.firstCallAt ? Math.round(((new Date(c.firstCallAt).getTime() - new Date(c.queueEnteredAt).getTime()) / 3600_000) * 100) / 100 : null,
      closureReason: c.closureReason,
      closureNote: c.closureNote,
      closedAt: c.closedAt,
      reopenCount: c.reopenCount,
      previousCaseId: c.previousCaseId,
      ageing: { inStageWorkingHours: Math.round(inStage * 100) / 100, openWorkingHours: Math.round(open * 100) / 100 },
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  });
}

export async function loadCase(tx: Tx, tenantId: string, caseId: string): Promise<CaseRow | null> {
  const r = await tx.select().from(schema.cases).where(and(eq(schema.cases.tenantId, tenantId), eq(schema.cases.id, caseId))).limit(1);
  return r[0] ?? null;
}
