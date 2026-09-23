import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { importSystems } from "@/modules/m08-calc-designer/service";
import { SystemsImport } from "@/modules/m08-calc-designer/schemas";

export const POST = route({ roles: ["ITARANG_ADMIN"], body: SystemsImport }, async ({ ctx, params, body }) => ok(await importSystems(ctx, params.releaseId, body)));
