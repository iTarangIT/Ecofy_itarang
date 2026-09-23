import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { putAppliances } from "@/modules/m08-calc-designer/service";
import { AppliancesPut } from "@/modules/m08-calc-designer/schemas";

export const PUT = route({ roles: ["ITARANG_ADMIN"], body: AppliancesPut }, async ({ ctx, params, body }) => { await putAppliances(ctx, params.releaseId, body); return empty(200); });
