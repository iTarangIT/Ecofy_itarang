import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { getAsset } from "@/modules/m13-asset/service";

export const GET = route({ roles: ADMINS }, async ({ ctx, params }) => ok(await getAsset(ctx, params.assetId)));
