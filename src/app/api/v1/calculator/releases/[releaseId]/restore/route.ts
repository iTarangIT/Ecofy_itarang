import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { restoreRelease } from "@/modules/m08-calc-designer/service";
import { ReleaseCreate } from "@/modules/m08-calc-designer/schemas";

export const POST = route({ roles: ["ITARANG_ADMIN"], body: ReleaseCreate }, async ({ ctx, params, body }) => created(await restoreRelease(ctx, params.releaseId, body.changeNote)));
