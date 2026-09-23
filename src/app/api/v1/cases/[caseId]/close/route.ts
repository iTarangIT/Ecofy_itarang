import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { closeCase } from "@/modules/m04-qualify/service";
import { Close } from "@/modules/m04-qualify/schemas";

export const POST = route({ roles: ALL_ROLES, body: Close, ifMatch: true }, async ({ ctx, params, body, ifMatch }) => ok(await closeCase(ctx, params.caseId, ifMatch, body)));
