import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { fileOfCase } from "@/modules/m10-acceptance/service";

/** Additive: the File of a case (null before acceptance). */
export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await fileOfCase(ctx, params.caseId)));
