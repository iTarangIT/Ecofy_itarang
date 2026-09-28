import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { rejectRelease } from "@/modules/m08-calc-designer/service";
import { ReleaseDecision } from "@/modules/m08-calc-designer/schemas";

// CONFLICTS #31: the designer moved into the iTarang CRM, which acts as an iTarang Admin, so it may reject too.
export const POST = route({ roles: ADMINS, body: ReleaseDecision }, async ({ ctx, params, body }) => ok(await rejectRelease(ctx, params.releaseId, body.note)));
