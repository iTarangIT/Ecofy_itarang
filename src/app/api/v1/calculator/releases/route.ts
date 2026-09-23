import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { listReleases, createDraft } from "@/modules/m08-calc-designer/service";
import { ReleaseCreate } from "@/modules/m08-calc-designer/schemas";

export const GET = route({ roles: ADMINS }, async ({ ctx }) => ok(await listReleases(ctx)));
export const POST = route({ roles: ["ITARANG_ADMIN"], body: ReleaseCreate }, async ({ ctx, body }) => created(await createDraft(ctx, body)));
