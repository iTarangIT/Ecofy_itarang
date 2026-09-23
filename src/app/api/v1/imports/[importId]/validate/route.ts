import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { validateImport } from "@/modules/m03-intake/service";

export const POST = route({ roles: ADMINS }, async ({ ctx, params }) => ok(await validateImport(ctx, params.importId)));
