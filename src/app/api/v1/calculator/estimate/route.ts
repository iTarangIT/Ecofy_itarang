import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { estimate } from "@/modules/m07-assessment/service";
import { CalcInput } from "@/modules/m07-assessment/schemas";

export const POST = route({ roles: ALL_ROLES, body: CalcInput }, async ({ ctx, body }) => ok(await estimate(ctx, body)));
