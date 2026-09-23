import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { getImport } from "@/modules/m03-intake/service";

export const GET = route({ roles: ADMINS }, async ({ ctx, params }) => ok(await getImport(ctx, params.importId)));
