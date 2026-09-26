import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { IMPORTERS } from "@/core/auth/rbac";
import { getImport } from "@/modules/m03-intake/service";

export const GET = route({ roles: IMPORTERS }, async ({ ctx, params }) => ok(await getImport(ctx, params.importId)));
