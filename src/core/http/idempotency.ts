import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema } from "@/core/db/client";
import type { RequestContext } from "./context";
import { errors } from "./errors";
import type { Ok } from "./envelope";

export function hashBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body ?? null)).digest("hex");
}

/**
 * Idempotency-Key semantics (BRD §6): a replay within 24 h returns the first result; the same key
 * with a different body returns 422. A placeholder row is inserted first so a concurrent duplicate
 * blocks on the primary key and then sees the stored response.
 */
export async function withIdempotency(ctx: RequestContext, key: string, route: string, body: unknown, run: () => Promise<Ok>): Promise<Ok> {
  const tenantId = ctx.auth.tenantId;
  const requestHash = hashBody(body);
  const existing = await ctx.tx
    .select()
    .from(schema.idempotencyKeys)
    .where(and(eq(schema.idempotencyKeys.tenantId, tenantId), eq(schema.idempotencyKeys.key, key)))
    .limit(1);
  if (existing[0]) {
    const row = existing[0];
    if (row.requestHash !== requestHash) throw errors.idempotencyReused();
    if (row.statusCode == null) throw errors.rateLimited("The same request is still being processed");
    const stored = (row.response ?? {}) as { data?: unknown; meta?: unknown };
    return { data: stored.data, meta: stored.meta as Ok["meta"], status: row.statusCode, headers: { "Idempotent-Replayed": "true" } };
  }
  try {
    await ctx.tx.insert(schema.idempotencyKeys).values({ tenantId, key, userId: ctx.auth.userId, route, requestHash, statusCode: null, response: null });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "23505") throw errors.rateLimited("The same request is still being processed");
    throw e;
  }
  const result = await run();
  await ctx.tx
    .update(schema.idempotencyKeys)
    .set({ statusCode: result.status ?? 200, response: { data: result.data, meta: result.meta ?? null } })
    .where(and(eq(schema.idempotencyKeys.tenantId, tenantId), eq(schema.idempotencyKeys.key, key)));
  return result;
}
