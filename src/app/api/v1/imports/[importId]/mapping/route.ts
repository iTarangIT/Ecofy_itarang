import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { saveMapping } from "@/modules/m03-intake/service";
import { ImportMapping } from "@/modules/m03-intake/schemas";

export const POST = route({ roles: ADMINS, body: ImportMapping }, async ({ ctx, params, body }) => ok(await saveMapping(ctx, params.importId, body)));
