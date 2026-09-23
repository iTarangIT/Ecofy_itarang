import { and, eq, sql, asc } from "drizzle-orm";
import type { z } from "zod";
import { schema, type Tx } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { getAllSettings, invalidateSetting, SETTING_DEFAULTS, type SettingKey } from "@/core/settings/settingsCache";
import { invalidateCalendar } from "@/core/calendar/loadCalendar";
import { encodeCursor, decodeCursor, verbatim } from "@/core/http/serialize";
import type { RequestContext } from "@/core/http/context";
import { LIST_CODES, type CalendarPut, type EpcPartnerIn, type EpcPartnerPatch, type FinancierIn, type FinancierPatch, type ListItemCreate, type ListItemPatch, type ListCode } from "./schemas";

// ------------------------------------------------------------------ settings (FR-02.1, FR-02.6)
export async function getSettings(ctx: RequestContext) {
  return verbatim(await getAllSettings(ctx.auth.tenantId, ctx.tx));
}

const SETTING_ENUMS: Partial<Record<SettingKey, string[]>> = { "gates.s4_order": ["ELIGIBILITY_FIRST", "QUOTE_FIRST", "PARALLEL"] };

export async function patchSetting(ctx: RequestContext, key: string, value: unknown, reason?: string) {
  if (!(key in SETTING_DEFAULTS)) throw errors.notFound("Setting");
  const k = key as SettingKey;
  const def = SETTING_DEFAULTS[k];
  // type must match the seed's type (OpenAPI SettingPatch); null-defaults accept strings
  const expected = def === null ? "string" : Array.isArray(def) ? "array" : typeof def;
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (!(actual === expected || (def === null && actual === "null"))) throw errors.validation(`Setting ${key} expects ${expected}`, { expected, actual });
  if (SETTING_ENUMS[k] && !SETTING_ENUMS[k]!.includes(String(value))) throw errors.validation(`Setting ${key} must be one of ${SETTING_ENUMS[k]!.join(", ")}`);
  if (expected === "number" && (typeof value !== "number" || value < 0)) throw errors.validation(`Setting ${key} must be a non-negative number`);
  const tenantId = ctx.auth.tenantId;
  const before = (await ctx.tx.select().from(schema.settings).where(and(eq(schema.settings.tenantId, tenantId), eq(schema.settings.key, key))).limit(1))[0];
  await ctx.tx
    .insert(schema.settings)
    .values({ tenantId, key, value: value as object, updatedBy: ctx.auth.userId, updatedAt: ctx.now })
    .onConflictDoUpdate({ target: [schema.settings.tenantId, schema.settings.key], set: { value: value as object, updatedBy: ctx.auth.userId, updatedAt: ctx.now } });
  invalidateSetting(tenantId, key);
  await audit(ctx, { action: "setting.change", entityType: "setting", entityId: key, before: { value: before?.value ?? def }, after: { value }, reason });
  await emit(ctx, "setting.changed", tenantId, { key, old: before?.value ?? def, new: value });
}

// ------------------------------------------------------------------ lists (FR-02.2)
export async function listItems(ctx: RequestContext, listCode: string, includeInactive = true) {
  if (!LIST_CODES.includes(listCode as ListCode)) throw errors.notFound("List");
  const conds = [eq(schema.listItems.tenantId, ctx.auth.tenantId), eq(schema.listItems.listCode, listCode)];
  if (!includeInactive) conds.push(eq(schema.listItems.active, true));
  const rows = await ctx.tx.select().from(schema.listItems).where(and(...conds)).orderBy(asc(schema.listItems.sortOrder), asc(schema.listItems.label));
  return rows.map((r) => ({ id: r.id, listCode: r.listCode, code: r.code, label: r.label, sortOrder: r.sortOrder, active: r.active }));
}

export async function createListItem(ctx: RequestContext, listCode: string, input: z.infer<typeof ListItemCreate>) {
  if (!LIST_CODES.includes(listCode as ListCode)) throw errors.notFound("List");
  const row = (await ctx.tx.insert(schema.listItems).values({ tenantId: ctx.auth.tenantId, listCode, code: input.code, label: input.label, sortOrder: input.sortOrder ?? 0 }).returning())[0];
  await audit(ctx, { action: "list.item_created", entityType: "list_item", entityId: row.id, after: { listCode, code: input.code, label: input.label } });
  await emit(ctx, "list.changed", row.id, { listCode, code: input.code });
  return row;
}

export async function patchListItem(ctx: RequestContext, listCode: string, itemId: string, input: z.infer<typeof ListItemPatch>) {
  const cur = (await ctx.tx.select().from(schema.listItems).where(and(eq(schema.listItems.tenantId, ctx.auth.tenantId), eq(schema.listItems.listCode, listCode), eq(schema.listItems.id, itemId))).limit(1))[0];
  if (!cur) throw errors.notFound("List item");
  const set: Partial<typeof schema.listItems.$inferInsert> = {};
  if (input.label !== undefined) set.label = input.label;
  if (input.sortOrder !== undefined) set.sortOrder = input.sortOrder;
  if (input.active !== undefined) set.active = input.active;
  const row = (await ctx.tx.update(schema.listItems).set(set).where(eq(schema.listItems.id, cur.id)).returning())[0];
  await audit(ctx, { action: "list.item_updated", entityType: "list_item", entityId: cur.id, before: { label: cur.label, sortOrder: cur.sortOrder, active: cur.active }, after: set });
  await emit(ctx, "list.changed", cur.id, { listCode, code: cur.code });
  return row;
}

/** Validate a code against a list (active items only). */
export async function assertListCode(tx: Tx, tenantId: string, listCode: ListCode, code: string | null | undefined, field: string, required = false) {
  if (code == null || code === "") {
    if (required) throw errors.validation(`${field} is required`);
    return;
  }
  const r = await tx.select({ id: schema.listItems.id }).from(schema.listItems).where(and(eq(schema.listItems.tenantId, tenantId), eq(schema.listItems.listCode, listCode), eq(schema.listItems.code, code), eq(schema.listItems.active, true))).limit(1);
  if (!r[0]) throw errors.validation(`${field}: '${code}' is not an active ${listCode} code`, { field, code });
}

// ------------------------------------------------------------------ calendar (FR-02.3)
export async function getCalendar(ctx: RequestContext) {
  const wh = await ctx.tx.select().from(schema.workingHours).where(eq(schema.workingHours.tenantId, ctx.auth.tenantId)).orderBy(asc(schema.workingHours.weekday));
  const hol = await ctx.tx.select().from(schema.holidays).where(eq(schema.holidays.tenantId, ctx.auth.tenantId)).orderBy(asc(schema.holidays.day));
  return { workingHours: wh.map((w) => ({ weekday: w.weekday, start: String(w.startTime).slice(0, 5), end: String(w.endTime).slice(0, 5) })), holidays: hol.map((h) => ({ day: String(h.day), name: h.name })) };
}

export async function putCalendar(ctx: RequestContext, input: z.infer<typeof CalendarPut>) {
  const tenantId = ctx.auth.tenantId;
  for (const w of input.workingHours) if (w.end <= w.start) throw errors.validation(`weekday ${w.weekday}: end must be after start`);
  const before = await getCalendar(ctx);
  await ctx.tx.delete(schema.workingHours).where(eq(schema.workingHours.tenantId, tenantId));
  if (input.workingHours.length) await ctx.tx.insert(schema.workingHours).values(input.workingHours.map((w) => ({ tenantId, weekday: w.weekday, startTime: w.start, endTime: w.end })));
  await ctx.tx.delete(schema.holidays).where(eq(schema.holidays.tenantId, tenantId));
  if (input.holidays.length) await ctx.tx.insert(schema.holidays).values(input.holidays.map((h) => ({ tenantId, day: h.day, name: h.name })));
  invalidateCalendar(tenantId);
  await audit(ctx, { action: "calendar.change", entityType: "calendar", entityId: tenantId, before, after: input });
  await emit(ctx, "setting.changed", tenantId, { key: "calendar" });
}

// ------------------------------------------------------------------ EPC partners (FR-02.4)
export function epcOut(p: typeof schema.epcPartners.$inferSelect) {
  return { id: p.id, name: p.name, contactName: p.contactName, mobile: p.mobileE164?.replace(/^\+91/, "") ?? null, email: p.email, pincodes: p.pincodes, segments: p.segments, active: p.active, createdAt: p.createdAt };
}

export async function listEpcPartners(ctx: RequestContext, q: { cursor?: string; limit?: number; activeOnly?: boolean }) {
  const limit = q.limit ?? 100;
  const cur = decodeCursor<{ name: string }>(q.cursor);
  const conds = [eq(schema.epcPartners.tenantId, ctx.auth.tenantId)];
  if (q.activeOnly) conds.push(eq(schema.epcPartners.active, true));
  if (cur) conds.push(sql`${schema.epcPartners.name} > ${cur.name}`);
  const rows = await ctx.tx.select().from(schema.epcPartners).where(and(...conds)).orderBy(asc(schema.epcPartners.name)).limit(limit + 1);
  const page = rows.slice(0, limit);
  return { data: page.map(epcOut), meta: { nextCursor: rows.length > limit ? encodeCursor({ name: page[page.length - 1].name }) : null, limit } };
}

export async function createEpcPartner(ctx: RequestContext, input: z.infer<typeof EpcPartnerIn>) {
  const row = (await ctx.tx.insert(schema.epcPartners).values({ tenantId: ctx.auth.tenantId, name: input.name, contactName: input.contactName ?? null, mobileE164: input.mobile ? `+91${input.mobile}` : null, email: input.email ?? null, pincodes: input.pincodes, segments: input.segments, active: input.active ?? true }).returning())[0];
  await audit(ctx, { action: "epc_partner.create", entityType: "epc_partner", entityId: row.id, after: epcOut(row) });
  return epcOut(row);
}

export async function patchEpcPartner(ctx: RequestContext, id: string, input: z.infer<typeof EpcPartnerPatch>) {
  const cur = (await ctx.tx.select().from(schema.epcPartners).where(and(eq(schema.epcPartners.tenantId, ctx.auth.tenantId), eq(schema.epcPartners.id, id))).limit(1))[0];
  if (!cur) throw errors.notFound("EPC partner");
  const set: Partial<typeof schema.epcPartners.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.contactName !== undefined) set.contactName = input.contactName;
  if (input.mobile !== undefined) set.mobileE164 = `+91${input.mobile}`;
  if (input.email !== undefined) set.email = input.email;
  if (input.pincodes !== undefined) set.pincodes = input.pincodes;
  if (input.segments !== undefined) set.segments = input.segments;
  if (input.active !== undefined) set.active = input.active;
  const row = (await ctx.tx.update(schema.epcPartners).set(set).where(eq(schema.epcPartners.id, cur.id)).returning())[0];
  await audit(ctx, { action: "epc_partner.update", entityType: "epc_partner", entityId: cur.id, before: epcOut(cur), after: epcOut(row) });
  return epcOut(row);
}

// ------------------------------------------------------------------ financiers (FR-02.5)
export function financierOut(f: typeof schema.financiers.$inferSelect) {
  return { id: f.id, name: f.name, isDefault: f.isDefault, valuesVisibleTo: f.valuesVisibleTo, active: f.active };
}

export async function listFinanciers(ctx: RequestContext, q: { cursor?: string; limit?: number }) {
  const limit = q.limit ?? 100;
  const rows = await ctx.tx.select().from(schema.financiers).where(eq(schema.financiers.tenantId, ctx.auth.tenantId)).orderBy(sql`${schema.financiers.isDefault} desc`, asc(schema.financiers.name)).limit(limit);
  return { data: rows.map(financierOut), meta: { nextCursor: null, limit } };
}

export async function createFinancier(ctx: RequestContext, input: z.infer<typeof FinancierIn>) {
  const row = (await ctx.tx.insert(schema.financiers).values({ tenantId: ctx.auth.tenantId, name: input.name, isDefault: false, valuesVisibleTo: input.valuesVisibleTo, active: input.active ?? true }).returning())[0];
  await audit(ctx, { action: "financier.create", entityType: "financier", entityId: row.id, after: financierOut(row) });
  return financierOut(row);
}

export async function patchFinancier(ctx: RequestContext, id: string, input: z.infer<typeof FinancierPatch>) {
  const cur = (await ctx.tx.select().from(schema.financiers).where(and(eq(schema.financiers.tenantId, ctx.auth.tenantId), eq(schema.financiers.id, id))).limit(1))[0];
  if (!cur) throw errors.notFound("Financier");
  if (cur.isDefault && input.active === false) throw errors.validation("The default financier cannot be deactivated");
  const set: Partial<typeof schema.financiers.$inferInsert> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.valuesVisibleTo !== undefined) set.valuesVisibleTo = input.valuesVisibleTo;
  if (input.active !== undefined) set.active = input.active;
  const row = (await ctx.tx.update(schema.financiers).set(set).where(eq(schema.financiers.id, cur.id)).returning())[0];
  await audit(ctx, { action: "financier.update", entityType: "financier", entityId: cur.id, before: financierOut(cur), after: financierOut(row) });
  return financierOut(row);
}

export async function defaultFinancier(tx: Tx, tenantId: string) {
  const r = (await tx.select().from(schema.financiers).where(and(eq(schema.financiers.tenantId, tenantId), eq(schema.financiers.isDefault, true))).limit(1))[0];
  if (!r) throw errors.internal("No default financier configured");
  return r;
}

export async function financierById(tx: Tx, tenantId: string, id: string) {
  const r = (await tx.select().from(schema.financiers).where(and(eq(schema.financiers.tenantId, tenantId), eq(schema.financiers.id, id))).limit(1))[0];
  if (!r) throw errors.notFound("Financier");
  return r;
}
