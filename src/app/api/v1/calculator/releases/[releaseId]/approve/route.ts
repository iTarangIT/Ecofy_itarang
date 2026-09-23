import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { approveRelease } from "@/modules/m08-calc-designer/service";
import { ReleaseDecision } from "@/modules/m08-calc-designer/schemas";

export const POST = route({ roles: ["ECOFY_ADMIN"], body: ReleaseDecision }, async ({ ctx, params, body }) => ok(await approveRelease(ctx, params.releaseId, body.note)));
