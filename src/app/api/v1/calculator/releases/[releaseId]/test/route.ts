import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { testBench } from "@/modules/m08-calc-designer/service";
import { CalcInput } from "@/modules/m07-assessment/schemas";

export const POST = route({ roles: ADMINS, body: CalcInput }, async ({ ctx, params, body }) => ok(await testBench(ctx, params.releaseId, body)));
