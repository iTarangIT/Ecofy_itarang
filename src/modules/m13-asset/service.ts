import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { encodeCursor, decodeCursor } from "@/core/http/serialize";
import type { RequestContext } from "@/core/http/context";
import { requireCase } from "@/modules/m04-qualify/service";

export type AssetRow = typeof schema.assets.$inferSelect;

async function assetOut(ctx: RequestContext, a: AssetRow) {
  const c = await requireCase(ctx, a.caseId);
  const customer = (await ctx.tx.select({ fullName: schema.customers.fullName, city: schema.customers.city }).from(schema.customers).where(eq(schema.customers.id, c.customerId)).limit(1))[0];
  const emi = await ctx.tx.select().from(schema.emiStatusUpdates).where(eq(schema.emiStatusUpdates.assetId, a.id)).orderBy(desc(schema.emiStatusUpdates.asOf));
  const events = await ctx.tx.select().from(schema.assetEvents).where(eq(schema.assetEvents.assetId, a.id)).orderBy(schema.assetEvents.onDate);
  return {
    id: a.id, caseId: a.caseId, caseNo: c.caseNo, customerName: customer?.fullName ?? null, city: customer?.city ?? null, systemSnapshot: a.systemSnapshot, commissionedOn: a.commissionedOn, status: a.status, createdAt: a.createdAt,
    emiStatus: emi[0] ? { asOf: emi[0].asOf, state: emi[0].state, note: emi[0].note } : null,
    emiHistory: emi.map((e) => ({ id: Number(e.id), asOf: e.asOf, state: e.state, note: e.note, recordedAt: e.recordedAt })),
    events: events.map((e) => ({ id: Number(e.id), type: e.type, onDate: e.onDate, note: e.note, recordedAt: e.recordedAt })),
  };
}

export async function listAssets(ctx: RequestContext, q: { cursor?: string; limit?: number; status?: string }) {
  const limit = q.limit ?? 50;
  const conds = [eq(schema.assets.tenantId, ctx.auth.tenantId)];
  if (q.status) conds.push(inArray(schema.assets.status, q.status.split(",") as Array<"ACTIVE" | "BUYBACK" | "REDEPLOYED" | "CLOSED">));
  const cur = decodeCursor<{ at: string; id: string }>(q.cursor);
  if (cur) conds.push(sql`(${schema.assets.createdAt}, ${schema.assets.id}) < (${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const rows = await ctx.tx.select().from(schema.assets).where(and(...conds)).orderBy(desc(schema.assets.createdAt), desc(schema.assets.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const visible = [];
  for (const a of page) {
    try { visible.push(await assetOut(ctx, a)); } catch { /* case out of scope (RLS) */ }
  }
  const last = page[page.length - 1];
  return { data: visible, meta: { nextCursor: rows.length > limit && last ? encodeCursor({ at: last.createdAt.toISOString(), id: last.id }) : null, limit } };
}

export async function getAsset(ctx: RequestContext, id: string) {
  const a = (await ctx.tx.select().from(schema.assets).where(and(eq(schema.assets.tenantId, ctx.auth.tenantId), eq(schema.assets.id, id))).limit(1))[0];
  if (!a) throw errors.notFound("Asset");
  return assetOut(ctx, a);
}

/** FR-13.2: EMI status by as-of date (DPD band), recorded by Ecofy Admin under Ecofy's policy. */
export async function recordEmiStatus(ctx: RequestContext, assetId: string, input: { asOf: string; state: "CURRENT" | "DPD_1_30" | "DPD_31_60" | "DPD_61_90" | "DPD_90_PLUS" | "CLOSED"; note?: string }) {
  const a = (await ctx.tx.select().from(schema.assets).where(and(eq(schema.assets.tenantId, ctx.auth.tenantId), eq(schema.assets.id, assetId))).limit(1))[0];
  if (!a) throw errors.notFound("Asset");
  await requireCase(ctx, a.caseId);
  const row = (await ctx.tx.insert(schema.emiStatusUpdates).values({ tenantId: a.tenantId, assetId: a.id, asOf: input.asOf, state: input.state, note: input.note ?? null, recordedBy: ctx.auth.userId, recordedAt: ctx.now }).returning())[0];
  await audit(ctx, { action: "emi.update", entityType: "asset", entityId: a.id, caseId: a.caseId, after: { asOf: input.asOf, state: input.state } });
  await emit(ctx, "emi.updated", a.id, { caseId: a.caseId, asOf: input.asOf, state: input.state });
  return { id: Number(row.id), asOf: row.asOf, state: row.state, note: row.note, recordedAt: row.recordedAt };
}

/** FR-13.3: buyback and redeployment (and closure) as asset events; status follows the latest event. */
export async function recordAssetEvent(ctx: RequestContext, assetId: string, input: { type: "BUYBACK" | "REDEPLOYED" | "CLOSED"; onDate: string; note?: string }) {
  const a = (await ctx.tx.select().from(schema.assets).where(and(eq(schema.assets.tenantId, ctx.auth.tenantId), eq(schema.assets.id, assetId))).limit(1))[0];
  if (!a) throw errors.notFound("Asset");
  await requireCase(ctx, a.caseId);
  const row = (await ctx.tx.insert(schema.assetEvents).values({ tenantId: a.tenantId, assetId: a.id, type: input.type, onDate: input.onDate, note: input.note ?? null, recordedBy: ctx.auth.userId, recordedAt: ctx.now }).returning())[0];
  await ctx.tx.update(schema.assets).set({ status: input.type }).where(eq(schema.assets.id, a.id));
  await audit(ctx, { action: "asset.event", entityType: "asset", entityId: a.id, caseId: a.caseId, before: { status: a.status }, after: { status: input.type, onDate: input.onDate } });
  await emit(ctx, "asset.event_recorded", a.id, { caseId: a.caseId, type: input.type });
  return { id: Number(row.id), type: row.type, onDate: row.onDate, note: row.note, recordedAt: row.recordedAt, assetStatus: input.type };
}
