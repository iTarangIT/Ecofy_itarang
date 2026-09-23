import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { patchUser } from "@/modules/m01-access/service";
import { UserPatch } from "@/modules/m01-access/schemas";

export const PATCH = route({ roles: ADMINS, body: UserPatch }, async ({ ctx, body, params }) => ok(await patchUser(ctx, params.userId, body)));
