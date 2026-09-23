import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { putSystems } from "@/modules/m08-calc-designer/service";
import { SystemsPut } from "@/modules/m08-calc-designer/schemas";

export const PUT = route({ roles: ["ITARANG_ADMIN"], body: SystemsPut }, async ({ ctx, params, body }) => { await putSystems(ctx, params.releaseId, body); return empty(200); });
