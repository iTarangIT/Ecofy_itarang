import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { listActivities, logActivity } from "@/modules/m06-followup/service";
import { ActivityCreate } from "@/modules/m06-followup/schemas";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await listActivities(ctx, params.caseId)));
export const POST = route({ roles: ALL_ROLES, body: ActivityCreate }, async ({ ctx, params, body }) => created(await logActivity(ctx, params.caseId, body)));
