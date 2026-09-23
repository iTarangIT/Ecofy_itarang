import { and, eq, desc, gte, lte, ilike, sql, inArray } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { encodeCursor, decodeCursor } from "@/core/http/serialize";
import type { RequestContext } from "@/core/http/context";
import { audit } from "@/core/audit/audit";

export type AuditQuery = { caseId?: string; userId?: string; action?: string; from?: string; to?: string; cursor?: string; limit?: number };

/**
 * GET /audit — admins. Ecofy Admin sees Ecofy-visible cases only: rows tied to a case are filtered
 * through the RLS-scoped `cases` table; rows without a case are visible to both admins.
 */
export async function searchAudit(ctx: RequestContext, q: AuditQuery) {
  const limit = q.limit ?? 50;
  const conds = [eq(schema.auditLog.tenantId, ctx.auth.tenantId)];
  if (q.caseId) conds.push(eq(schema.auditLog.caseId, q.caseId));
  if (q.userId) conds.push(eq(schema.auditLog.actorId, q.userId));
  if (q.action) conds.push(ilike(schema.auditLog.action, `${q.action}%`));
  if (q.from) conds.push(gte(schema.auditLog.at, new Date(q.from)));
  if (q.to) conds.push(lte(schema.auditLog.at, new Date(q.to)));
  if (ctx.auth.role === "ECOFY_ADMIN") conds.push(sql`(${schema.auditLog.caseId} is null or ${schema.auditLog.caseId} in (select id from cases))`);
  const cur = decodeCursor<{ id: number }>(q.cursor);
  if (cur) conds.push(sql`${schema.auditLog.id} < ${cur.id}`);
  const rows = await ctx.tx.select().from(schema.auditLog).where(and(...conds)).orderBy(desc(schema.auditLog.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const ids = [...new Set(page.map((r) => r.actorId).filter((x): x is string => Boolean(x)))];
  const users = ids.length ? await ctx.tx.select({ id: schema.users.id, fullName: schema.users.fullName }).from(schema.users).where(inArray(schema.users.id, ids)) : [];
  const umap = new Map(users.map((u) => [u.id, u.fullName]));
  return {
    data: page.map((r) => ({ id: Number(r.id), at: r.at, actorId: r.actorId, actorName: r.actorId ? umap.get(r.actorId) ?? null : "Platform", actorRole: r.actorRole, action: r.action, entityType: r.entityType, entityId: r.entityId, caseId: r.caseId, before: r.before, after: r.after, reason: r.reason, ip: r.ip })),
    meta: { nextCursor: rows.length > limit ? encodeCursor({ id: Number(page[page.length - 1].id) }) : null, limit },
  };
}

export async function logExport(ctx: RequestContext, code: string, filters: Record<string, unknown>, rows: number) {
  await audit(ctx, { action: "export.generate", entityType: "report", entityId: code, after: { filters, rows } });
}
