import { sql } from "drizzle-orm";
import { db, type Tx } from "./client";
import type { Role } from "@/core/auth/rbac";

/** Per-transaction database context read by the RLS policies (app_tenant(), app_user(), app_role()). */
export type DbContext = {
  tenantId: string;
  userId: string | null; // null = platform
  role: Role | "";
};

/**
 * Runs `fn` inside one transaction whose session settings carry the tenant, user and role.
 * `set_config(..., true)` is transaction-local, so pooled connections never leak context.
 */
export async function withDbContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setContext(tx, ctx);
    return fn(tx);
  });
}

export async function setContext(tx: Tx, ctx: DbContext) {
  await tx.execute(
    sql`select set_config('app.tenant_id', ${ctx.tenantId}, true),
               set_config('app.user_id', ${ctx.userId ?? ""}, true),
               set_config('app.role', ${ctx.role ?? ""}, true)`,
  );
}

/**
 * Platform context for background jobs: full tenant visibility, actor NULL.
 * (`case_scope` admits ITARANG_ADMIN; audit rows written with actor_id NULL = platform.)
 */
export function withSystemContext<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withDbContext({ tenantId, userId: null, role: "ITARANG_ADMIN" }, fn);
}
