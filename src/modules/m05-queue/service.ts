import { and, eq, sql, asc, isNull } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { transition, lockCase } from "@/core/state-engine/transition";
import { encodeCursor, decodeCursor } from "@/core/http/serialize";
import type { RequestContext } from "@/core/http/context";
import { caseOut } from "@/modules/m04-qualify/caseView";
import { assertListCode } from "@/modules/m02-settings/service";

/** FR-05.1: Hot first, then Warm by push time; ageing in working hours; no targets or colours. */
export async function queue(ctx: RequestContext, q: { cursor?: string; limit?: number }) {
  const limit = q.limit ?? 50;
  const cur = decodeCursor<{ rank: number; at: string; id: string }>(q.cursor);
  const rank = sql<number>`case when ${schema.cases.temperature} = 'HOT' then 0 else 1 end`;
  const conds = [eq(schema.cases.tenantId, ctx.auth.tenantId), eq(schema.cases.stage, "S1")];
  if (cur) conds.push(sql`(${rank}, ${schema.cases.queueEnteredAt}, ${schema.cases.id}) > (${cur.rank}, ${cur.at}::timestamptz, ${cur.id}::uuid)`);
  const rows = await ctx.tx.select().from(schema.cases).where(and(...conds)).orderBy(rank, asc(schema.cases.queueEnteredAt), asc(schema.cases.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, page, { list: true, now: ctx.now }),
    meta: { nextCursor: rows.length > limit && last ? encodeCursor({ rank: last.temperature === "HOT" ? 0 : 1, at: (last.queueEnteredAt ?? last.stageEnteredAt).toISOString(), id: last.id }) : null, limit },
  };
}

/** FR-05.3: return to Ecofy with a reason from the list; case goes back to S0 and to its qualifier. */
export async function returnToEcofy(ctx: RequestContext, caseId: string, ifMatch: number | null, input: { reasonCode: string; note?: string }) {
  const c = await lockCase(ctx, caseId, ifMatch);
  if (c.stage !== "S1" && c.stage !== "S2") throw errors.gate("stage", "Return to Ecofy is available at S1 (or S2) only");
  await assertListCode(ctx.tx, c.tenantId, "return_reason", input.reasonCode, "reasonCode", true);
  const returnedTo = c.qualifiedBy ?? null;
  await ctx.tx.insert(schema.caseReturns).values({ tenantId: c.tenantId, caseId: c.id, reasonCode: input.reasonCode, note: input.note ?? null, returnedBy: ctx.auth.userId, returnedTo, at: ctx.now });
  await ctx.tx.update(schema.caseAssignments).set({ endedAt: ctx.now }).where(and(eq(schema.caseAssignments.caseId, c.id), isNull(schema.caseAssignments.endedAt)));
  if (returnedTo) await ctx.tx.insert(schema.caseAssignments).values({ tenantId: c.tenantId, caseId: c.id, userId: returnedTo, assignedBy: ctx.auth.userId, reason: `Returned: ${input.reasonCode}`, assignedAt: ctx.now });
  const next = await transition(ctx, {
    caseId: c.id, expectedVersion: c.version, to: "S0", set: { assignedUserId: returnedTo, temperature: null, queueEnteredAt: null }, reason: input.reasonCode,
    auditAction: "case.return", eventType: "case.returned",
    eventPayload: { reasonCode: input.reasonCode, returnedTo, notify: returnedTo ? [{ userId: returnedTo, type: "case.returned", title: `${c.caseNo} returned by iTarang: ${input.reasonCode}`, body: input.note, caseId: c.id }] : [{ role: "ECOFY_ADMIN", type: "case.returned", title: `${c.caseNo} returned by iTarang: ${input.reasonCode}`, body: input.note, caseId: c.id }] },
  });
  return (await caseOut(ctx.tx, ctx.auth.tenantId, ctx.auth.role, [next], { now: ctx.now }))[0];
}
