import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { getCase } from "@/modules/m04-qualify/service";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await getCase(ctx, params.caseId)));
