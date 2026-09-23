import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { getSettings } from "@/modules/m02-settings/service";

export const GET = route({ roles: ADMINS }, async ({ ctx }) => ok(await getSettings(ctx)));
