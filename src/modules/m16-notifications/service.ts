import { and, eq, desc, isNull, inArray } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { tenantOf, type ActorContext } from "@/core/http/context";
import { errors } from "@/core/http/errors";
import type { Role } from "@/core/auth/rbac";

/**
 * M16 in-app bell. Producers describe recipients inside the outbox payload (`notify: NotifyTarget[]`);
 * the worker turns them into rows. Services may also write rows directly in their own transaction.
 */
export type NotifyTarget = { userId?: string; role?: Role; type: string; title: string; body?: string; caseId?: string | null };

export async function createNotifications(ctx: ActorContext, targets: NotifyTarget[]) {
  const tenantId = tenantOf(ctx);
  const rows: (typeof schema.notifications.$inferInsert)[] = [];
  for (const t of targets) {
    const userIds: string[] = [];
    if (t.userId) userIds.push(t.userId);
    if (t.role) {
      const users = await ctx.tx
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, t.role), eq(schema.users.status, "ACTIVE")));
      userIds.push(...users.map((u) => u.id));
    }
    for (const userId of new Set(userIds)) rows.push({ tenantId, userId, type: t.type, title: t.title, body: t.body ?? null, caseId: t.caseId ?? null });
  }
  if (rows.length) await ctx.tx.insert(schema.notifications).values(rows);
  return rows.length;
}

export async function listNotifications(ctx: ActorContext, userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const where = opts.unreadOnly
    ? and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt))
    : eq(schema.notifications.userId, userId);
  return ctx.tx.select().from(schema.notifications).where(where).orderBy(desc(schema.notifications.createdAt)).limit(opts.limit ?? 50);
}

export async function markRead(ctx: ActorContext, userId: string, id: number) {
  const r = await ctx.tx
    .update(schema.notifications)
    .set({ readAt: ctx.now })
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.userId, userId)))
    .returning({ id: schema.notifications.id });
  if (!r[0]) throw errors.notFound("Notification");
}

export async function unreadCount(ctx: ActorContext, userId: string): Promise<number> {
  const rows = await ctx.tx.select({ id: schema.notifications.id }).from(schema.notifications).where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return rows.length;
}

/** Idempotency helper for jobs: does a notification of this type already exist for these users? */
export async function notificationExists(ctx: ActorContext, type: string, userIds: string[]): Promise<boolean> {
  if (!userIds.length) return false;
  const rows = await ctx.tx.select({ id: schema.notifications.id }).from(schema.notifications).where(and(eq(schema.notifications.type, type), inArray(schema.notifications.userId, userIds))).limit(1);
  return rows.length > 0;
}
