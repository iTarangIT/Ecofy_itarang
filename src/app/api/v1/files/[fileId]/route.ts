import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { getFile } from "@/modules/m10-acceptance/service";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await getFile(ctx, params.fileId)));
