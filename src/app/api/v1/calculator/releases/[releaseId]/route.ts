import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { getRelease, patchDraft } from "@/modules/m08-calc-designer/service";
import { ReleasePatch } from "@/modules/m08-calc-designer/schemas";

export const GET = route({ roles: ADMINS }, async ({ ctx, params }) => ok(await getRelease(ctx, params.releaseId)));
export const PATCH = route({ roles: ["ITARANG_ADMIN"], body: ReleasePatch }, async ({ ctx, params, body }) => ok(await patchDraft(ctx, params.releaseId, body)));
