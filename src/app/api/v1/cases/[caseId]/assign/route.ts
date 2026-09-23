import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { assign } from "@/modules/m04-qualify/service";
import { Assign } from "@/modules/m04-qualify/schemas";

export const POST = route({ roles: ADMINS, body: Assign, ifMatch: true }, async ({ ctx, params, body, ifMatch }) => ok(await assign(ctx, params.caseId, ifMatch, body)));
