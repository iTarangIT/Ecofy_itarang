import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { timeline } from "@/modules/m04-qualify/service";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await timeline(ctx, params.caseId)));
