import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { stringify } from "csv-stringify/sync";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { encodeCursor, decodeCursor } from "@/core/http/serialize";
import type { RequestContext } from "@/core/http/context";
import { requireCase } from "@/modules/m04-qualify/service";
import { parseUpload } from "@/modules/m03-intake/parse";

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
  // one status per asset per as-of date (UNIQUE (asset_id, as_of)): re-recording the same day replaces it
  const row = (await ctx.tx.insert(schema.emiStatusUpdates).values({ tenantId: a.tenantId, assetId: a.id, asOf: input.asOf, state: input.state, note: input.note ?? null, recordedBy: ctx.auth.userId, recordedAt: ctx.now })
    .onConflictDoUpdate({ target: [schema.emiStatusUpdates.assetId, schema.emiStatusUpdates.asOf], set: { state: input.state, note: input.note ?? null, recordedBy: ctx.auth.userId, recordedAt: ctx.now } }).returning())[0];
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

// ------------------------------------------------------------------ EMI tracker (CONFLICTS #32): one row per asset, filters, CSV, bulk upload

export const EMI_STATES = ["CURRENT", "DPD_1_30", "DPD_31_60", "DPD_61_90", "DPD_90_PLUS", "CLOSED"] as const;
export type EmiState = (typeof EMI_STATES)[number];
type AssetStatus = "ACTIVE" | "BUYBACK" | "REDEPLOYED" | "CLOSED";

export type EmiTrackerFilters = { q?: string; state?: string; status?: string; asOfFrom?: string; asOfTo?: string; city?: string; limit?: number };
export type EmiTrackerRow = {
  assetId: string; caseId: string; caseNo: string; fileNo: string | null; customerName: string; city: string | null; system: string | null; commissionedOn: string; assetStatus: AssetStatus;
  emi: { asOf: string; state: EmiState; note: string | null; recordedAt: Date } | null;
  previous: { asOf: string; state: EmiState } | null;
  updates: number;
};

const csvList = (v?: string) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);

/** Every asset the caller may see with its latest EMI status; the filters apply to that latest status. Newest as-of first, then case number. */
export async function emiTracker(ctx: RequestContext, f: EmiTrackerFilters): Promise<EmiTrackerRow[]> {
  const rows = await ctx.tx
    .select({ a: schema.assets, caseNo: schema.cases.caseNo, customerName: schema.customers.fullName, city: schema.customers.city })
    .from(schema.assets)
    .innerJoin(schema.cases, eq(schema.cases.id, schema.assets.caseId)) // RLS case_scope drops assets outside the caller's scope
    .innerJoin(schema.customers, eq(schema.customers.id, schema.cases.customerId))
    .where(eq(schema.assets.tenantId, ctx.auth.tenantId));
  const ids = rows.map((r) => r.a.id);
  const updates = ids.length ? await ctx.tx.select().from(schema.emiStatusUpdates).where(inArray(schema.emiStatusUpdates.assetId, ids)).orderBy(desc(schema.emiStatusUpdates.asOf), desc(schema.emiStatusUpdates.id)) : [];
  const byAsset = new Map<string, typeof updates>();
  for (const u of updates) byAsset.set(u.assetId, [...(byAsset.get(u.assetId) ?? []), u]);

  const states = csvList(f.state).map((x) => x.toUpperCase());
  const statuses = csvList(f.status).map((x) => x.toUpperCase());
  const q = (f.q ?? "").trim().toLowerCase();
  const city = (f.city ?? "").trim().toLowerCase();

  const out: EmiTrackerRow[] = [];
  for (const r of rows) {
    const snap = (r.a.systemSnapshot ?? {}) as { system?: string | null; fileNo?: string | null };
    const hist = byAsset.get(r.a.id) ?? [];
    const latest = hist[0], prev = hist[1];
    const row: EmiTrackerRow = {
      assetId: r.a.id, caseId: r.a.caseId, caseNo: r.caseNo, fileNo: snap.fileNo ?? null, customerName: r.customerName, city: r.city ?? null, system: snap.system ?? null, commissionedOn: r.a.commissionedOn, assetStatus: r.a.status,
      emi: latest ? { asOf: latest.asOf, state: latest.state, note: latest.note, recordedAt: latest.recordedAt } : null,
      previous: prev ? { asOf: prev.asOf, state: prev.state } : null,
      updates: hist.length,
    };
    if (states.length && !(row.emi ? states.includes(row.emi.state) : states.includes("NONE"))) continue;
    if (statuses.length && !statuses.includes(row.assetStatus)) continue;
    if (f.asOfFrom && (!row.emi || row.emi.asOf < f.asOfFrom)) continue;
    if (f.asOfTo && (!row.emi || row.emi.asOf > f.asOfTo)) continue;
    if (city && !(row.city ?? "").toLowerCase().includes(city)) continue;
    if (q && ![row.caseNo, row.fileNo ?? "", row.customerName].some((x) => x.toLowerCase().includes(q))) continue;
    out.push(row);
  }
  out.sort((x, y) => (y.emi?.asOf ?? "").localeCompare(x.emi?.asOf ?? "") || x.caseNo.localeCompare(y.caseNo));
  return f.limit ? out.slice(0, f.limit) : out;
}

const LATEST_COLUMNS = ["case_no", "file_no", "customer", "city", "system", "commissioned_on", "lifecycle", "as_of", "state", "note", "recorded_at", "previous_as_of", "previous_state", "updates"];
const HISTORY_COLUMNS = ["case_no", "file_no", "customer", "city", "system", "commissioned_on", "lifecycle", "as_of", "state", "note", "recorded_at"];

/** CSV of the tracker: `latest` = one row per asset (re-uploadable as-is); `history` = every EMI status ever recorded. Logged like the other exports. */
export async function emiTrackerCsv(ctx: RequestContext, f: EmiTrackerFilters, scope: "latest" | "history" = "latest") {
  const rows = await emiTracker(ctx, f);
  const base = (r: EmiTrackerRow) => ({ case_no: r.caseNo, file_no: r.fileNo ?? "", customer: r.customerName, city: r.city ?? "", system: r.system ?? "", commissioned_on: r.commissionedOn, lifecycle: r.assetStatus });
  let records: Record<string, unknown>[];
  if (scope === "history") {
    const ids = rows.map((r) => r.assetId);
    const hist = ids.length ? await ctx.tx.select().from(schema.emiStatusUpdates).where(inArray(schema.emiStatusUpdates.assetId, ids)).orderBy(desc(schema.emiStatusUpdates.asOf), desc(schema.emiStatusUpdates.id)) : [];
    const byId = new Map(rows.map((r) => [r.assetId, r]));
    records = hist.map((h) => ({ ...base(byId.get(h.assetId)!), as_of: h.asOf, state: h.state, note: h.note ?? "", recorded_at: h.recordedAt.toISOString() }));
  } else {
    records = rows.map((r) => ({ ...base(r), as_of: r.emi?.asOf ?? "", state: r.emi?.state ?? "", note: r.emi?.note ?? "", recorded_at: r.emi?.recordedAt.toISOString() ?? "", previous_as_of: r.previous?.asOf ?? "", previous_state: r.previous?.state ?? "", updates: r.updates }));
  }
  await audit(ctx, { action: "export.generate", entityType: "report", entityId: `emi-tracker-${scope}`, after: { rows: records.length, filters: f } });
  return stringify(records, { header: true, columns: scope === "history" ? HISTORY_COLUMNS : LATEST_COLUMNS });
}

/** Upload template: the columns the bulk upload reads. case_no or file_no identifies the lead. */
export function emiUploadTemplateCsv() {
  return stringify([{ case_no: "ECF-1001", file_no: "", as_of: "2026-09-30", state: "CURRENT", note: "example row — replace with your leads" }], { header: true, columns: ["case_no", "file_no", "as_of", "state", "note"] });
}

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, "");
const HEADER_ALIASES: Record<string, string[]> = {
  caseNo: ["caseno", "case", "caseid", "casenumber", "lead", "leadno", "leadid"],
  fileNo: ["fileno", "file", "filenumber"],
  asOf: ["asof", "asofdate", "date", "statusdate", "emidate"],
  state: ["state", "status", "emistatus", "emistate", "dpd", "dpdband", "band"],
  note: ["note", "notes", "remark", "remarks", "comment"],
};

/** "DPD 1-30", "dpd_31_60", "90+", "current", "closed" → the emi_state enum; anything else is rejected. */
export function normEmiState(v: string): EmiState | null {
  const s = v.trim().toUpperCase().replace(/[\s-]+/g, "_").replace(/\+$/, "_PLUS");
  if ((EMI_STATES as readonly string[]).includes(s)) return s as EmiState;
  const m = s.match(/^(?:DPD_?)?(\d+)(?:_(\d+)|_PLUS)?$/);
  if (m) { const lo = Number(m[1]); if (lo >= 90) return "DPD_90_PLUS"; if (lo >= 61) return "DPD_61_90"; if (lo >= 31) return "DPD_31_60"; if (lo >= 1) return "DPD_1_30"; return "CURRENT"; }
  if (["REGULAR", "PAID", "ON_TIME", "OK"].includes(s)) return "CURRENT";
  if (["FORECLOSED", "COMPLETED", "FULLY_PAID"].includes(s)) return "CLOSED";
  return null;
}

/** YYYY-MM-DD (optionally with a time) or DD-MM-YYYY / DD/MM/YYYY → YYYY-MM-DD. */
export function normEmiDate(v: string): string | null {
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

export type EmiUploadResult = { fileName: string; total: number; applied: number; failed: number; errors: Array<{ row: number; caseNo: string; fileNo: string; code: string; message: string }> };

/**
 * Bulk EMI status upload (Ecofy Admin): a .csv/.xlsx with case_no or file_no + as_of + state (+ note). Each row runs
 * `recordEmiStatus` in its own savepoint, so one bad row never blocks the rest; the result lists every rejected row.
 */
export async function uploadEmiStatuses(ctx: RequestContext, input: { fileName: string; contentBase64: string }): Promise<EmiUploadResult> {
  const buf = Buffer.from(input.contentBase64, "base64");
  if (!buf.length) throw errors.validation("The file is empty");
  const MAX = 5000;
  const parsed = await parseUpload(buf, input.fileName, ["EMI", "Sheet1"], MAX + 1);
  if (parsed.rows.length > MAX) throw errors.validation(`At most ${MAX} rows per upload`);
  const colFor = (key: string) => parsed.headers.find((h) => HEADER_ALIASES[key]!.includes(normHeader(h)));
  const cols = { caseNo: colFor("caseNo"), fileNo: colFor("fileNo"), asOf: colFor("asOf"), state: colFor("state"), note: colFor("note") };
  if (!cols.caseNo && !cols.fileNo) throw errors.validation("The file needs a case_no or file_no column");
  if (!cols.asOf || !cols.state) throw errors.validation("The file needs as_of and state columns");
  const asOfCol = cols.asOf, stateCol = cols.state;

  const tenantId = ctx.auth.tenantId;
  const result: EmiUploadResult = { fileName: input.fileName, total: parsed.rows.length, applied: 0, failed: 0, errors: [] };
  const assetByKey = new Map<string, string>();
  const fail = (row: number, caseNo: string, fileNo: string, code: string, message: string) => { result.failed++; result.errors.push({ row, caseNo, fileNo, code, message }); };

  for (let i = 0; i < parsed.rows.length; i++) {
    const r = parsed.rows[i]!;
    const rowNo = i + 2; // spreadsheet row: 1-based, after the header
    const caseNo = (cols.caseNo ? r[cols.caseNo] ?? "" : "").trim().toUpperCase();
    const fileNo = (cols.fileNo ? r[cols.fileNo] ?? "" : "").trim().toUpperCase();
    const asOf = normEmiDate(r[asOfCol] ?? "");
    const state = normEmiState(r[stateCol] ?? "");
    const note = (cols.note ? r[cols.note] ?? "" : "").trim().slice(0, 500) || undefined;
    if (!caseNo && !fileNo) { fail(rowNo, caseNo, fileNo, "MISSING_KEY", "case_no or file_no is required"); continue; }
    if (!asOf) { fail(rowNo, caseNo, fileNo, "BAD_DATE", `as_of "${r[asOfCol] ?? ""}" is not a date (use YYYY-MM-DD or DD-MM-YYYY)`); continue; }
    if (!state) { fail(rowNo, caseNo, fileNo, "BAD_STATE", `state "${r[stateCol] ?? ""}" is not one of ${EMI_STATES.join(", ")}`); continue; }

    const key = caseNo ? `case:${caseNo}` : `file:${fileNo}`;
    let assetId = assetByKey.get(key);
    if (!assetId) {
      const caseId = caseNo
        ? (await ctx.tx.select({ id: schema.cases.id }).from(schema.cases).where(and(eq(schema.cases.tenantId, tenantId), eq(schema.cases.caseNo, caseNo))).limit(1))[0]?.id
        : (await ctx.tx.select({ caseId: schema.files.caseId }).from(schema.files).where(and(eq(schema.files.tenantId, tenantId), eq(schema.files.fileNo, fileNo))).limit(1))[0]?.caseId;
      if (!caseId) { fail(rowNo, caseNo, fileNo, "NOT_FOUND", caseNo ? `No case ${caseNo} visible to you` : `No File ${fileNo} visible to you`); continue; }
      const asset = (await ctx.tx.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.tenantId, tenantId), eq(schema.assets.caseId, caseId))).orderBy(desc(schema.assets.createdAt)).limit(1))[0];
      if (!asset) { fail(rowNo, caseNo, fileNo, "NO_ASSET", "No asset yet — assets are created when the disbursement is recorded"); continue; }
      assetId = asset.id;
      assetByKey.set(key, assetId);
    }
    const id = assetId;
    try {
      // savepoint per row so one failure does not poison the transaction
      await ctx.tx.transaction(async (inner) => { await recordEmiStatus({ ...ctx, tx: inner }, id, { asOf, state, note }); });
      result.applied++;
    } catch (e) {
      fail(rowNo, caseNo, fileNo, (e as { code?: string }).code ?? "ERROR", (e as Error).message || "Could not record the status");
    }
  }
  await audit(ctx, { action: "emi.bulk_upload", entityType: "asset", entityId: "emi-tracker", after: { fileName: input.fileName, total: result.total, applied: result.applied, failed: result.failed } });
  return result;
}
