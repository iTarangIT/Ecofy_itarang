import { z } from "zod";
import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { listNotifications, unreadCount } from "@/modules/m16-notifications/service";

const Q = z.object({ unread: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
export const GET = route({ roles: ALL_ROLES, query: Q }, async ({ ctx, query }) => {
  const rows = await listNotifications(ctx, ctx.auth.userId, { unreadOnly: query.unread === "true", limit: query.limit });
  return ok(rows.map((r) => ({ ...r, id: Number(r.id) })), { meta: { unread: await unreadCount(ctx, ctx.auth.userId) } });
});
