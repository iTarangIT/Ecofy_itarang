import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { IMPORTERS } from "@/core/auth/rbac";
import { saveMapping } from "@/modules/m03-intake/service";
import { ImportMapping } from "@/modules/m03-intake/schemas";

export const POST = route({ roles: IMPORTERS, body: ImportMapping }, async ({ ctx, params, body }) => ok(await saveMapping(ctx, params.importId, body)));
