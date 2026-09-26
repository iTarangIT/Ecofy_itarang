import { and, eq, asc, desc, inArray, sql } from "drizzle-orm";
import { schema, type Tx } from "@/core/db/client";
import { withDbContext } from "@/core/db/tx";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { getSetting } from "@/core/settings/settingsCache";
import { storage } from "@/adapters";
import { istDate, parseDdMmYyyy } from "@/core/calendar/dates";
import { transition } from "@/core/state-engine/transition";
import type { ActorContext, RequestContext, SystemContext } from "@/core/http/context";
import type { Role } from "@/core/auth/rbac";
import { defaultFinancier } from "@/modules/m02-settings/service";
import { parseUpload } from "./parse";
import { TEMPLATE_COLUMNS, MANDATORY, suggestMapping, toCode, normaliseMobile, type TemplateColumn, type RowError } from "./template";
import type { CaseCreateT, CustomerInT } from "./schemas";
import { stringify } from "csv-stringify/sync";
import { verbatim } from "@/core/http/serialize";

type ImportBatch = typeof schema.importBatches.$inferSelect;

// ================================================================== single lead (FR-03.8, FR-03.9)

export type NewCaseInput = {
  customer: CustomerInT;
  segment: "RESI" | "ESS" | "CI";
  productInterest?: string | null;
  avgMonthlyBillInr?: number | null;
  sanctionedLoadKw?: number | null;
  existingBackup?: string | null;
  preferredCallTime?: string | null;
  ecofyLeadId?: string | null;
  source: "ECOFY_UPLOAD" | "ECOFY_MANUAL" | "CALCULATOR" | "ITARANG_SOURCED";
  ownerKind: "ECOFY" | "ITARANG";
  startStage: "S0" | "S1";
  assignTo?: string | null;
  qualifiedBy?: string | null;
  importBatchId?: string | null;
  createdBy: string | null;
};

export type UpsertOutcome = { result: "CREATED" | "DUPLICATE" | "REOPENED" | "NEW_LINKED"; caseId: string; caseNo: string };

async function orgIdByKind(tx: Tx, tenantId: string, kind: "ECOFY" | "ITARANG") {
  const o = (await tx.select({ id: schema.orgs.id }).from(schema.orgs).where(and(eq(schema.orgs.tenantId, tenantId), eq(schema.orgs.kind, kind))).limit(1))[0];
  if (!o) throw errors.internal(`org ${kind} missing`);
  return o.id;
}

/**
 * Dedupe on mobile (FR-03.6): open case → linked, no new case; closed case → reopened with history,
 * unless it reached a File → new case linked through previous_case_id.
 */
export async function upsertLead(ctx: ActorContext, tenantId: string, input: NewCaseInput): Promise<UpsertOutcome> {
  const mobile = `+91${input.customer.mobile}`;
  const existing = (await ctx.tx.select().from(schema.customers).where(and(eq(schema.customers.tenantId, tenantId), eq(schema.customers.mobileE164, mobile))).limit(1))[0];
  const financier = await defaultFinancier(ctx.tx, tenantId);
  const ownerOrgId = await orgIdByKind(ctx.tx, tenantId, input.ownerKind);

  let customerId: string;
  if (existing) {
    customerId = existing.id;
    // an open case for this customer: link, no new case
    const open = (await ctx.tx.select().from(schema.cases).where(and(eq(schema.cases.customerId, existing.id), sql`${schema.cases.stage} <> 'CLOSED'`)).limit(1))[0];
    if (open) {
      await audit(ctx, { action: "case.duplicate_linked", entityType: "case", entityId: open.id, caseId: open.id, after: { source: input.source, importBatchId: input.importBatchId ?? null } });
      return { result: "DUPLICATE", caseId: open.id, caseNo: open.caseNo };
    }
    // most recent closed case
    const closed = (await ctx.tx.select().from(schema.cases).where(eq(schema.cases.customerId, existing.id)).orderBy(sql`${schema.cases.closedAt} desc nulls last`).limit(1))[0];
    if (closed) {
      const hasFile = (await ctx.tx.select({ id: schema.files.id }).from(schema.files).where(eq(schema.files.caseId, closed.id)).limit(1))[0];
      if (!hasFile) {
        // reopen with history (FR-14.7)
        const assignTo = input.assignTo ?? (input.ownerKind === "ECOFY" ? closed.qualifiedBy : null);
        const reopened = await transition(ctx, {
          caseId: closed.id, expectedVersion: null, to: input.startStage, subStatus: null, reason: "Re-uploaded lead",
          set: {
            closureReason: null, closureNote: null, closedAt: null, temperature: null, reopenCount: closed.reopenCount + 1,
            assignedUserId: assignTo ?? null, importBatchId: input.importBatchId ?? closed.importBatchId, financierId: financier.id,
            queueEnteredAt: input.startStage === "S1" ? ctx.now : null,
          },
          auditAction: "case.reopen", eventType: "case.reopened", eventPayload: { by: "re-upload" },
        });
        if (assignTo) await ctx.tx.insert(schema.caseAssignments).values({ tenantId, caseId: reopened.id, userId: assignTo, assignedBy: input.createdBy ?? assignTo, reason: "Re-uploaded lead", assignedAt: ctx.now });
        return { result: "REOPENED", caseId: reopened.id, caseNo: reopened.caseNo };
      }
      const created = await insertCase(ctx, tenantId, input, existing.id, ownerOrgId, financier.id, closed.id);
      return { result: "NEW_LINKED", caseId: created.id, caseNo: created.caseNo };
    }
  } else {
    const c = input.customer;
    customerId = (await ctx.tx.insert(schema.customers).values({
      tenantId, fullName: c.fullName, mobileE164: mobile, altMobileE164: c.altMobile ? `+91${c.altMobile}` : null, email: c.email?.toLowerCase() ?? null,
      customerType: c.customerType, businessName: c.businessName ?? null, address: c.address, city: c.city, state: c.state, pincode: c.pincode,
      preferredLanguage: c.preferredLanguage ?? null, propertyType: c.propertyType ?? null, consentObtained: true, consentDate: c.consentDate, consentSource: c.consentSource,
    }).returning({ id: schema.customers.id }))[0].id;
  }
  const created = await insertCase(ctx, tenantId, input, customerId, ownerOrgId, financier.id, null);
  return { result: "CREATED", caseId: created.id, caseNo: created.caseNo };
}

async function insertCase(ctx: ActorContext, tenantId: string, input: NewCaseInput, customerId: string, ownerOrgId: string, financierId: string, previousCaseId: string | null) {
  const row = (await ctx.tx.insert(schema.cases).values({
    tenantId, customerId, segment: input.segment, source: input.source, ownerOrgId, stage: input.startStage, stageEnteredAt: ctx.now,
    qualifiedBy: input.qualifiedBy ?? null, assignedUserId: input.assignTo ?? null, queueEnteredAt: input.startStage === "S1" ? ctx.now : null, financierId,
    productInterest: input.productInterest ?? null, avgMonthlyBillInr: input.avgMonthlyBillInr ?? null,
    sanctionedLoadKw: input.sanctionedLoadKw == null ? null : String(input.sanctionedLoadKw), existingBackup: input.existingBackup ?? null,
    preferredCallTime: input.preferredCallTime ?? null, ecofyLeadId: input.ecofyLeadId ?? null, importBatchId: input.importBatchId ?? null,
    previousCaseId, createdBy: input.createdBy, createdAt: ctx.now, updatedAt: ctx.now,
  }).returning())[0];
  await ctx.tx.insert(schema.caseStageHistory).values({ tenantId, caseId: row.id, fromStage: null, toStage: input.startStage, actorId: input.createdBy, at: ctx.now, reason: previousCaseId ? "New case linked to a closed case with a File" : null });
  if (input.assignTo) await ctx.tx.insert(schema.caseAssignments).values({ tenantId, caseId: row.id, userId: input.assignTo, assignedBy: input.createdBy ?? input.assignTo, assignedAt: ctx.now });
  await audit(ctx, { action: "case.create", entityType: "case", entityId: row.id, caseId: row.id, after: { caseNo: row.caseNo, stage: row.stage, source: input.source, previousCaseId } });
  await emit(ctx, "case.created", row.id, {
    caseNo: row.caseNo, stage: row.stage, source: input.source, previousCaseId,
    notify: input.assignTo ? [{ userId: input.assignTo, type: "case.assigned", title: `New lead ${row.caseNo} assigned to you`, caseId: row.id }] : input.startStage === "S1" ? [{ role: "ITARANG_ADMIN", type: "queue.new", title: `${row.caseNo} entered the pickup queue`, caseId: row.id }] : [],
  });
  return row;
}

/** POST /cases — EU: S0 owner Ecofy (qualifier = self); EA: S0 owner Ecofy; IA: S1 owner iTarang. */
export async function createSingleCase(ctx: RequestContext, input: CaseCreateT) {
  const role = ctx.auth.role;
  const tenantId = ctx.auth.tenantId;
  await validateListCodes(ctx.tx, tenantId, { consentSource: input.customer.consentSource, preferredLanguage: input.customer.preferredLanguage, propertyType: input.customer.propertyType, productInterest: input.productInterest, existingBackup: input.existingBackup, preferredCallTime: input.preferredCallTime });
  if (input.customer.customerType === "BUSINESS" && !input.customer.businessName) throw errors.validation("businessName is required for BUSINESS customers");
  if (input.customer.consentDate > istDate(ctx.now)) throw errors.validation("consentDate cannot be in the future");
  const isEcofy = role === "ECOFY_USER" || role === "ECOFY_ADMIN";
  const out = await upsertLead(ctx, tenantId, {
    customer: input.customer, segment: input.segment, productInterest: input.productInterest, avgMonthlyBillInr: input.avgMonthlyBillInr, sanctionedLoadKw: input.sanctionedLoadKw,
    existingBackup: input.existingBackup, preferredCallTime: input.preferredCallTime,
    source: isEcofy ? (input.fromEstimateId ? "CALCULATOR" : "ECOFY_MANUAL") : "ITARANG_SOURCED",
    ownerKind: isEcofy ? "ECOFY" : "ITARANG", startStage: isEcofy ? "S0" : "S1",
    assignTo: role === "ECOFY_USER" ? ctx.auth.userId : null, qualifiedBy: role === "ECOFY_USER" ? ctx.auth.userId : null,
    createdBy: ctx.auth.userId,
  });
  if (out.result === "DUPLICATE") throw errors.validation(`This customer already has an open case (${out.caseNo})`, { caseId: out.caseId, caseNo: out.caseNo });
  return out;
}

async function validateListCodes(tx: Tx, tenantId: string, v: { consentSource?: string; preferredLanguage?: string; propertyType?: string; productInterest?: string; existingBackup?: string; preferredCallTime?: string }) {
  const { assertListCode } = await import("@/modules/m02-settings/service");
  await assertListCode(tx, tenantId, "consent_source", v.consentSource, "consentSource", true);
  await assertListCode(tx, tenantId, "language", v.preferredLanguage, "preferredLanguage");
  await assertListCode(tx, tenantId, "property_type", v.propertyType, "propertyType");
  await assertListCode(tx, tenantId, "product_interest", v.productInterest, "productInterest");
  await assertListCode(tx, tenantId, "existing_backup", v.existingBackup, "existingBackup");
  await assertListCode(tx, tenantId, "call_time", v.preferredCallTime, "preferredCallTime");
}

// ================================================================== bulk import (FR-03.1 … FR-03.7, FR-03.11)

export function importOut(b: ImportBatch, extra: Record<string, unknown> = {}) {
  return {
    id: b.id, status: b.status, fileName: b.fileName, rowCount: b.rowCount, createdAt: b.createdAt, committedAt: b.committedAt, consentAttested: b.consentAttested, attestedAt: b.attestedAt,
    preview: { rowCount: b.rowCount, created: b.createdCount, duplicate: b.duplicateCount, reopened: b.reopenedCount, newLinked: 0, rejected: b.rejectedCount, sampleErrors: [] as unknown[] },
    ...extra,
  };
}

async function loadBatch(ctx: RequestContext, id: string): Promise<ImportBatch> {
  const b = (await ctx.tx.select().from(schema.importBatches).where(and(eq(schema.importBatches.tenantId, ctx.auth.tenantId), eq(schema.importBatches.id, id))).limit(1))[0];
  if (!b || (ctx.auth.role === "ECOFY_USER" && b.uploadedBy !== ctx.auth.userId)) throw errors.notFound("Import"); // an Ecofy User sees only their own imports
  return b;
}

export async function startImport(ctx: RequestContext, input: { fileName: string; sizeBytes: number }) {
  const ext = input.fileName.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
  const id = crypto.randomUUID();
  const key = `imports/${ctx.auth.tenantId}/${id}.${ext}`;
  await ctx.tx.insert(schema.importBatches).values({ id, tenantId: ctx.auth.tenantId, uploadedBy: ctx.auth.userId, fileKey: key, fileName: input.fileName, status: "UPLOADED", createdAt: ctx.now });
  const st = await storage();
  const ticket = await st.presignPut(key, { contentType: ext === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sizeBytes: input.sizeBytes });
  await audit(ctx, { action: "import.start", entityType: "import_batch", entityId: id, after: { fileName: input.fileName, sizeBytes: input.sizeBytes } });
  return { id, uploadUrl: ticket.url, expiresAt: ticket.expiresAt, headers: ticket.headers };
}

async function readBatchFile(b: ImportBatch, tenantId: string, tx: Tx) {
  const st = await storage();
  const head = await st.head(b.fileKey);
  if (!head) throw errors.validation("The file has not been uploaded yet");
  const max = Number(await getSetting(tenantId, "intake.max_rows", tx));
  const buf = await st.getObject(b.fileKey);
  const parsed = await parseUpload(buf, b.fileName, ["Leads"], max + 1);
  if (parsed.rows.length > max) throw errors.validation(`The file has more than ${max} rows`);
  return parsed;
}

/** GET /imports/{id}: status + (before mapping) the headers and a suggested mapping. */
export async function getImport(ctx: RequestContext, id: string) {
  const b = await loadBatch(ctx, id);
  const extra: Record<string, unknown> = {};
  if (b.status === "UPLOADED") {
    try {
      const parsed = await readBatchFile(b, ctx.auth.tenantId, ctx.tx);
      const saved = await ctx.tx.select().from(schema.columnMappings).where(eq(schema.columnMappings.tenantId, ctx.auth.tenantId));
      extra.headers = parsed.headers;
      extra.rowCount = parsed.rows.length;
      extra.suggestedMapping = verbatim(suggestMapping(parsed.headers));
      extra.savedMappings = saved.map((m) => ({ id: m.id, sourceName: m.sourceName, mapping: verbatim(m.mapping) }));
    } catch (e) {
      extra.uploadPending = true;
      extra.uploadError = (e as Error).message;
    }
  }
  if (b.status === "VALIDATED" || b.status === "COMMITTED" || b.status === "COMMITTING") {
    const errRows = await ctx.tx.select({ rowNo: schema.importRows.rowNo, errors: schema.importRows.errors, result: schema.importRows.result }).from(schema.importRows).where(and(eq(schema.importRows.batchId, b.id), eq(schema.importRows.result, "REJECTED"))).orderBy(asc(schema.importRows.rowNo)).limit(20);
    const linked = await ctx.tx.select({ n: sql<number>`count(*)::int` }).from(schema.importRows).where(and(eq(schema.importRows.batchId, b.id), sql`${schema.importRows.errors} @> '[{"code":"NEW_LINKED"}]'::jsonb`));
    extra.preview = { rowCount: b.rowCount, created: b.createdCount, duplicate: b.duplicateCount, reopened: b.reopenedCount, newLinked: linked[0]?.n ?? 0, rejected: b.rejectedCount, sampleErrors: errRows.flatMap((r) => ((r.errors as RowError[]) ?? []).map((e) => ({ rowNo: r.rowNo, column: e.column, code: e.code, message: e.message }))) };
  }
  if (b.status === "FAILED") {
    // The reason lives on the audit row written by failImportBatch (no column on import_batches).
    const last = (await ctx.tx.select({ reason: schema.auditLog.reason }).from(schema.auditLog).where(and(eq(schema.auditLog.tenantId, ctx.auth.tenantId), eq(schema.auditLog.action, "import.failed"), eq(schema.auditLog.entityId, b.id))).orderBy(desc(schema.auditLog.id)).limit(1))[0];
    if (last?.reason) extra.failureReason = last.reason;
  }
  return importOut(b, extra);
}

export async function saveMapping(ctx: RequestContext, id: string, input: { mapping: Record<string, string>; saveAs?: string }) {
  const b = await loadBatch(ctx, id);
  if (!["UPLOADED", "MAPPED", "VALIDATED"].includes(b.status)) throw errors.validation(`Import is ${b.status}`);
  const targets = Object.values(input.mapping);
  for (const t of targets) if (!(TEMPLATE_COLUMNS as readonly string[]).includes(t)) throw errors.validation(`Unknown template column '${t}'`);
  for (const m of MANDATORY) if (!targets.includes(m)) throw errors.validation(`Mandatory column '${m}' is not mapped`, { column: m });
  let mappingId: string | null = null;
  if (input.saveAs) {
    const row = (await ctx.tx
      .insert(schema.columnMappings)
      .values({ tenantId: ctx.auth.tenantId, sourceName: input.saveAs, mapping: input.mapping, createdBy: ctx.auth.userId })
      .onConflictDoUpdate({ target: [schema.columnMappings.tenantId, schema.columnMappings.sourceName], set: { mapping: input.mapping, createdBy: ctx.auth.userId } })
      .returning({ id: schema.columnMappings.id }))[0];
    mappingId = row.id;
  } else {
    const row = (await ctx.tx.insert(schema.columnMappings).values({ tenantId: ctx.auth.tenantId, sourceName: `batch:${b.id}`, mapping: input.mapping, createdBy: ctx.auth.userId }).returning({ id: schema.columnMappings.id }))[0];
    mappingId = row.id;
  }
  const updated = (await ctx.tx.update(schema.importBatches).set({ mappingId, status: "MAPPED" }).where(eq(schema.importBatches.id, b.id)).returning())[0];
  await audit(ctx, { action: "import.mapping", entityType: "import_batch", entityId: b.id, after: { mapping: input.mapping, saveAs: input.saveAs ?? null } });
  return importOut(updated);
}

type ValidatedRow = { rowNo: number; raw: Record<string, string>; lead: NewCaseInput | null; errors: RowError[]; predicted: "CREATED" | "DUPLICATE" | "REOPENED" | "NEW_LINKED" | "REJECTED" };

async function validateRows(tx: Tx, tenantId: string, b: ImportBatch, uploaderRole: Role, uploaderId: string, now: Date): Promise<ValidatedRow[]> {
  if (!b.mappingId) throw errors.validation("Save the column mapping first");
  const mappingRow = (await tx.select().from(schema.columnMappings).where(eq(schema.columnMappings.id, b.mappingId)).limit(1))[0];
  const mapping = (mappingRow?.mapping ?? {}) as Record<string, TemplateColumn>;
  const parsed = await readBatchFile(b, tenantId, tx);
  const lists = await tx.select({ listCode: schema.listItems.listCode, code: schema.listItems.code, label: schema.listItems.label }).from(schema.listItems).where(and(eq(schema.listItems.tenantId, tenantId), eq(schema.listItems.active, true)));
  const codesOf = (listCode: string) => new Set(lists.filter((l) => l.listCode === listCode).map((l) => l.code));
  const labelsOf = (listCode: string) => Object.fromEntries(lists.filter((l) => l.listCode === listCode).map((l) => [l.label.toLowerCase(), l.code]));
  const listFor: Partial<Record<TemplateColumn, { codes: Set<string>; labels: Record<string, string> }>> = {
    consent_source: { codes: codesOf("consent_source"), labels: labelsOf("consent_source") },
    preferred_language: { codes: codesOf("language"), labels: labelsOf("language") },
    property_type: { codes: codesOf("property_type"), labels: labelsOf("property_type") },
    product_interest: { codes: codesOf("product_interest"), labels: labelsOf("product_interest") },
    existing_backup: { codes: codesOf("existing_backup"), labels: labelsOf("existing_backup") },
    preferred_call_time: { codes: codesOf("call_time"), labels: labelsOf("call_time") },
  };
  const ecofyUsers = await tx.select({ id: schema.users.id, email: schema.users.email }).from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, "ECOFY_USER"), eq(schema.users.status, "ACTIVE")));
  const userByEmail = new Map(ecofyUsers.map((u) => [u.email.toLowerCase(), u.id]));
  const today = istDate(now);
  const seenMobiles = new Set<string>();
  const isIa = uploaderRole === "ITARANG_ADMIN";
  const isEu = uploaderRole === "ECOFY_USER"; // CONFLICTS #25: an Ecofy User's rows land in their own S0 queue (assign_to may name a colleague)

  const out: ValidatedRow[] = [];
  parsed.rows.forEach((raw, i) => {
    const rowNo = i + 2; // spreadsheet row (header = 1)
    const get = (col: TemplateColumn) => {
      const src = Object.entries(mapping).find(([, t]) => t === col)?.[0];
      return src ? (raw[src] ?? "").trim() : "";
    };
    const errs: RowError[] = [];
    for (const m of MANDATORY) if (!get(m)) errs.push({ column: m, code: "MISSING", message: `${m} is required` });
    const mobile = normaliseMobile(get("mobile"));
    if (get("mobile") && !mobile) errs.push({ column: "mobile", code: "INVALID_MOBILE", message: "mobile must be 10 digits starting 6–9" });
    const alt = get("alternate_mobile") ? normaliseMobile(get("alternate_mobile")) : null;
    if (get("alternate_mobile") && !alt) errs.push({ column: "alternate_mobile", code: "INVALID_MOBILE", message: "alternate_mobile must be 10 digits starting 6–9" });
    const segment = toCode("segment", get("segment"));
    if (get("segment") && !segment) errs.push({ column: "segment", code: "INVALID_SEGMENT", message: "segment must be RESI, ESS or C&I" });
    if (get("pincode") && !/^[1-9][0-9]{5}$/.test(get("pincode"))) errs.push({ column: "pincode", code: "INVALID_PINCODE", message: "pincode must be 6 digits" });
    if (get("consent_obtained") && get("consent_obtained").toUpperCase() !== "Y") errs.push({ column: "consent_obtained", code: "NO_CONSENT", message: "consent_obtained must be Y" });
    const consentDate = get("consent_date") ? parseDdMmYyyy(get("consent_date")) ?? (/^\d{4}-\d{2}-\d{2}$/.test(get("consent_date")) ? get("consent_date") : null) : null;
    if (get("consent_date") && !consentDate) errs.push({ column: "consent_date", code: "INVALID_DATE", message: "consent_date must be DD-MM-YYYY" });
    if (consentDate && consentDate > today) errs.push({ column: "consent_date", code: "FUTURE_DATE", message: "consent_date cannot be in the future" });
    const customerType = toCode("customer_type", get("customer_type"));
    if (get("customer_type") && !customerType) errs.push({ column: "customer_type", code: "INVALID_TYPE", message: "customer_type must be Individual or Business" });
    if (customerType === "BUSINESS" && !get("business_name")) errs.push({ column: "business_name", code: "MISSING", message: "business_name is required for Business" });
    const email = get("email").toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.push({ column: "email", code: "INVALID_EMAIL", message: "email is not valid" });
    const listCode = (col: TemplateColumn, required = false) => {
      const v = get(col);
      if (!v) { if (required) errs.push({ column: col, code: "MISSING", message: `${col} is required` }); return null; }
      const l = listFor[col]!;
      const code = l.labels[v.toLowerCase()] ?? toCode(col, v, l.codes);
      if (!code || !l.codes.has(code)) errs.push({ column: col, code: "INVALID_LIST_VALUE", message: `${col}: '${v}' is not an allowed value` });
      return code;
    };
    const consentSource = listCode("consent_source", true);
    const preferredLanguage = listCode("preferred_language");
    const propertyType = listCode("property_type");
    const productInterest = listCode("product_interest");
    const existingBackup = listCode("existing_backup");
    const preferredCallTime = listCode("preferred_call_time");
    const num = (col: TemplateColumn, int: boolean) => {
      const v = get(col);
      if (!v) return null;
      const n = Number(v.replace(/[,₹\s]/g, ""));
      if (!Number.isFinite(n) || n < 0 || (int && !Number.isInteger(n))) { errs.push({ column: col, code: "INVALID_NUMBER", message: `${col} must be a ${int ? "whole " : ""}number` }); return null; }
      return n;
    };
    const bill = num("avg_monthly_bill_inr", true);
    const load = num("sanctioned_load_kw", false);
    let assignTo: string | null = null;
    if (get("assign_to")) {
      assignTo = userByEmail.get(get("assign_to").toLowerCase()) ?? null; // FR-03.7: otherwise unassigned (not an error)
    }
    if (get("customer_name").length > 100) errs.push({ column: "customer_name", code: "TOO_LONG", message: "customer_name is longer than 100 characters" });
    if (get("address").length > 250) errs.push({ column: "address", code: "TOO_LONG", message: "address is longer than 250 characters" });

    if (mobile && seenMobiles.has(mobile)) errs.push({ column: "mobile", code: "IN_FILE_DUPLICATE", message: "mobile appears earlier in this file" });
    if (mobile) seenMobiles.add(mobile);

    if (errs.length) { out.push({ rowNo, raw, lead: null, errors: errs, predicted: errs.some((e) => e.code === "IN_FILE_DUPLICATE") && errs.length === 1 ? "DUPLICATE" : "REJECTED" }); return; }
    const lead: NewCaseInput = {
      customer: {
        fullName: get("customer_name"), mobile: mobile!.slice(3), altMobile: alt ? alt.slice(3) : undefined, email: email || undefined, customerType: customerType as "INDIVIDUAL" | "BUSINESS",
        businessName: get("business_name") || undefined, address: get("address"), city: get("city"), state: get("state"), pincode: get("pincode"),
        preferredLanguage: preferredLanguage ?? undefined, propertyType: propertyType ?? undefined, consentObtained: true, consentDate: consentDate!, consentSource: consentSource!,
      },
      segment: segment as "RESI" | "ESS" | "CI", productInterest, avgMonthlyBillInr: bill, sanctionedLoadKw: load, existingBackup, preferredCallTime, ecofyLeadId: get("ecofy_lead_id") || null,
      source: isIa ? "ITARANG_SOURCED" : "ECOFY_UPLOAD", ownerKind: isIa ? "ITARANG" : "ECOFY", startStage: isIa ? "S1" : "S0",
      assignTo: isIa ? null : (assignTo ?? (isEu ? uploaderId : null)), qualifiedBy: isEu ? uploaderId : null, importBatchId: b.id, createdBy: uploaderId,
    };
    out.push({ rowNo, raw, lead, errors: [], predicted: "CREATED" });
  });

  // predict dedupe outcomes against the database (preview only; commit re-evaluates)
  const mobiles = out.filter((r) => r.lead).map((r) => `+91${r.lead!.customer.mobile}`);
  if (mobiles.length) {
    const customers = await tx.select({ id: schema.customers.id, mobile: schema.customers.mobileE164 }).from(schema.customers).where(and(eq(schema.customers.tenantId, tenantId), inArray(schema.customers.mobileE164, mobiles)));
    const cmap = new Map(customers.map((c) => [c.mobile, c.id]));
    const cids = customers.map((c) => c.id);
    const cases = cids.length ? await tx.select({ id: schema.cases.id, customerId: schema.cases.customerId, stage: schema.cases.stage }).from(schema.cases).where(inArray(schema.cases.customerId, cids)) : [];
    const filesFor = cases.length ? await tx.select({ caseId: schema.files.caseId }).from(schema.files).where(inArray(schema.files.caseId, cases.map((c) => c.id))) : [];
    const withFile = new Set(filesFor.map((f) => f.caseId));
    for (const r of out) {
      if (!r.lead) continue;
      const cid = cmap.get(`+91${r.lead.customer.mobile}`);
      if (!cid) continue;
      const cs = cases.filter((c) => c.customerId === cid);
      if (cs.some((c) => c.stage !== "CLOSED")) r.predicted = "DUPLICATE";
      else if (cs.length && cs.every((c) => withFile.has(c.id))) r.predicted = "NEW_LINKED";
      else if (cs.length) r.predicted = "REOPENED";
    }
  }
  return out;
}

export async function validateImport(ctx: RequestContext, id: string) {
  const b = await loadBatch(ctx, id);
  if (!["MAPPED", "VALIDATED"].includes(b.status)) throw errors.validation(`Import is ${b.status}; save the mapping first`);
  const rows = await validateRows(ctx.tx, ctx.auth.tenantId, b, ctx.auth.role, ctx.auth.userId, ctx.now);
  await ctx.tx.delete(schema.importRows).where(eq(schema.importRows.batchId, b.id));
  for (let i = 0; i < rows.length; i += 500) {
    await ctx.tx.insert(schema.importRows).values(rows.slice(i, i + 500).map((r) => ({ tenantId: ctx.auth.tenantId, batchId: b.id, rowNo: r.rowNo, raw: r.raw, result: r.predicted === "REJECTED" ? "REJECTED" as const : null, errors: r.errors.length ? r.errors : r.predicted === "NEW_LINKED" ? [{ code: "NEW_LINKED", message: "previous case reached a File; a new linked case will be created" }] : null })));
  }
  const counts = { created: rows.filter((r) => r.predicted === "CREATED" || r.predicted === "NEW_LINKED").length, duplicate: rows.filter((r) => r.predicted === "DUPLICATE").length, reopened: rows.filter((r) => r.predicted === "REOPENED").length, newLinked: rows.filter((r) => r.predicted === "NEW_LINKED").length, rejected: rows.filter((r) => r.predicted === "REJECTED").length };
  const updated = (await ctx.tx.update(schema.importBatches).set({ status: "VALIDATED", rowCount: rows.length, createdCount: counts.created, duplicateCount: counts.duplicate, reopenedCount: counts.reopened, rejectedCount: counts.rejected }).where(eq(schema.importBatches.id, b.id)).returning())[0];
  await audit(ctx, { action: "import.validate", entityType: "import_batch", entityId: b.id, after: { rowCount: rows.length, ...counts } });
  const sampleErrors = rows.filter((r) => r.errors.length).slice(0, 20).flatMap((r) => r.errors.map((e) => ({ rowNo: r.rowNo, column: e.column, code: e.code, message: e.message })));
  return { rowCount: rows.length, ...counts, sampleErrors, import: importOut(updated) };
}

export async function commitImport(ctx: RequestContext, id: string, input: { consentAttested: true; attestationText: string }) {
  const b = await loadBatch(ctx, id);
  if (b.status === "COMMITTED" || b.status === "COMMITTING") return importOut(b);
  if (b.status !== "VALIDATED") throw errors.validation("Validate the import before committing");
  const expected = String(await getSetting(ctx.auth.tenantId, "intake.consent_attestation_text", ctx.tx));
  if (input.attestationText.trim() !== expected.trim()) throw errors.validation("The consent confirmation text does not match the configured attestation", { expected });
  const updated = (await ctx.tx.update(schema.importBatches).set({ status: "COMMITTING", consentAttested: true, attestationText: input.attestationText, attestedAt: ctx.now }).where(eq(schema.importBatches.id, b.id)).returning())[0];
  await audit(ctx, { action: "import.commit", entityType: "import_batch", entityId: b.id, after: { attestationText: input.attestationText, attestedAt: ctx.now } });
  await emit(ctx, "job.import.process", b.id, { batchId: b.id, uploaderId: ctx.auth.userId, uploaderRole: ctx.auth.role });
  return importOut(updated);
}

/**
 * Worker entry (import.process): re-validates and writes rows in chunks of 500 in the uploader's context.
 * An Ecofy User's batch runs with Ecofy Admin visibility (the uploader stays the actor): RLS would hide a colleague's
 * open case for the same mobile, and the one-open-case-per-customer rule would then fail the whole batch
 * instead of linking the row (FR-03.6). The rows themselves stay assigned to / qualified by the uploader.
 */
export async function runImportBatch(input: { tenantId: string; batchId: string; uploaderId: string; uploaderRole: Role }) {
  const dbRole: Role = input.uploaderRole === "ECOFY_USER" ? "ECOFY_ADMIN" : input.uploaderRole;
  await withDbContext({ tenantId: input.tenantId, userId: input.uploaderId, role: dbRole }, async (tx) => {
    const now = new Date();
    const ctx: SystemContext = { requestId: `import-${input.batchId}`, tenantId: input.tenantId, tx, now };
    const b = (await tx.select().from(schema.importBatches).where(and(eq(schema.importBatches.tenantId, input.tenantId), eq(schema.importBatches.id, input.batchId))).limit(1))[0];
    if (!b || b.status !== "COMMITTING") return;
    const rows = await validateRows(tx, input.tenantId, b, input.uploaderRole, input.uploaderId, now);
    const done = await tx.select({ rowNo: schema.importRows.rowNo, caseId: schema.importRows.caseId }).from(schema.importRows).where(and(eq(schema.importRows.batchId, b.id), sql`${schema.importRows.caseId} is not null`));
    const doneRows = new Set(done.map((d) => d.rowNo));
    const counts = { created: 0, duplicate: 0, reopened: 0, rejected: 0 };
    for (const r of rows) {
      if (doneRows.has(r.rowNo)) continue;
      if (!r.lead) {
        const dup = r.errors.length === 1 && r.errors[0].code === "IN_FILE_DUPLICATE";
        if (dup) counts.duplicate++; else counts.rejected++;
        await tx.insert(schema.importRows).values({ tenantId: input.tenantId, batchId: b.id, rowNo: r.rowNo, raw: r.raw, result: dup ? "DUPLICATE" : "REJECTED", errors: r.errors })
          .onConflictDoUpdate({ target: [schema.importRows.batchId, schema.importRows.rowNo], set: { result: dup ? "DUPLICATE" : "REJECTED", errors: r.errors } });
        continue;
      }
      const out = await upsertLead(ctx, input.tenantId, r.lead);
      const result = out.result === "NEW_LINKED" ? "CREATED" : out.result;
      if (result === "CREATED") counts.created++; else if (result === "DUPLICATE") counts.duplicate++; else counts.reopened++;
      const errs = out.result === "NEW_LINKED" ? [{ code: "NEW_LINKED", message: `linked to closed case with a File; new case ${out.caseNo}` }] : out.result === "DUPLICATE" ? [{ code: "DUPLICATE_OPEN_CASE", message: `linked to open case ${out.caseNo}` }] : null;
      await tx.insert(schema.importRows).values({ tenantId: input.tenantId, batchId: b.id, rowNo: r.rowNo, raw: r.raw, result, caseId: out.caseId, errors: errs })
        .onConflictDoUpdate({ target: [schema.importRows.batchId, schema.importRows.rowNo], set: { result, caseId: out.caseId, errors: errs } });
    }
    await tx.update(schema.importBatches).set({ status: "COMMITTED", committedAt: now, rowCount: rows.length, createdCount: counts.created, duplicateCount: counts.duplicate, reopenedCount: counts.reopened, rejectedCount: counts.rejected }).where(eq(schema.importBatches.id, b.id));
    await audit(ctx, { action: "import.committed", entityType: "import_batch", entityId: b.id, after: counts });
    await emit(ctx, "import.committed", b.id, { ...counts, notify: [{ userId: input.uploaderId, type: "import.committed", title: `Import ${b.fileName}: ${counts.created} created, ${counts.duplicate} duplicate, ${counts.reopened} reopened, ${counts.rejected} rejected` }] });
  });
}

/**
 * Terminal outcome of the import.process job: the batch cannot be committed (file missing, rows no longer
 * validate). Runs in its own transaction because the failing run was rolled back. Idempotent: only a batch
 * still COMMITTING is touched, so a redelivered job is a no-op. Returns whether the batch was marked.
 */
export async function failImportBatch(input: { tenantId: string; batchId: string; uploaderId: string; uploaderRole: Role }, reason: string): Promise<boolean> {
  return withDbContext({ tenantId: input.tenantId, userId: input.uploaderId, role: input.uploaderRole }, async (tx) => {
    const now = new Date();
    const ctx: SystemContext = { requestId: `import-`, tenantId: input.tenantId, tx, now };
    const b = (await tx.select().from(schema.importBatches).where(and(eq(schema.importBatches.tenantId, input.tenantId), eq(schema.importBatches.id, input.batchId))).limit(1))[0];
    if (!b || b.status !== "COMMITTING") return false;
    await tx.update(schema.importBatches).set({ status: "FAILED" }).where(eq(schema.importBatches.id, b.id));
    await audit(ctx, { action: "import.failed", entityType: "import_batch", entityId: b.id, before: { status: b.status }, after: { status: "FAILED" }, reason });
    await emit(ctx, "import.failed", b.id, { reason, notify: [{ userId: input.uploaderId, type: "import.failed", title: `Import  failed: `, body: "Start a new import with the file." }] });
    return true;
  });
}

export async function importReportCsv(ctx: RequestContext, id: string): Promise<string> {
  const b = await loadBatch(ctx, id);
  const rows = await ctx.tx.select().from(schema.importRows).where(eq(schema.importRows.batchId, b.id)).orderBy(asc(schema.importRows.rowNo));
  const caseIds = rows.map((r) => r.caseId).filter((x): x is string => Boolean(x));
  const cases = caseIds.length ? await ctx.tx.select({ id: schema.cases.id, caseNo: schema.cases.caseNo }).from(schema.cases).where(inArray(schema.cases.id, caseIds)) : [];
  const cmap = new Map(cases.map((c) => [c.id, c.caseNo]));
  const records = rows.map((r) => {
    const raw = (r.raw ?? {}) as Record<string, string>;
    return { row_no: r.rowNo, result: r.result ?? "", case_no: r.caseId ? cmap.get(r.caseId) ?? "" : "", reasons: ((r.errors as RowError[]) ?? []).map((e) => `${e.column ? e.column + ": " : ""}${e.message}`).join("; "), ...(r.raw ? { customer_name: raw.customer_name ?? raw.Name ?? "", mobile: raw.mobile ?? "" } : {}) };
  });
  await audit(ctx, { action: "export.generate", entityType: "import_batch", entityId: b.id, after: { report: "import-report.csv", rows: records.length } });
  return stringify(records, { header: true });
}
