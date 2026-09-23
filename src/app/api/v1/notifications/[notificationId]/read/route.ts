import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { markRead } from "@/modules/m16-notifications/service";

export const POST = route({ roles: ALL_ROLES }, async ({ ctx, params }) => { await markRead(ctx, ctx.auth.userId, Number(params.notificationId)); return empty(200); });
