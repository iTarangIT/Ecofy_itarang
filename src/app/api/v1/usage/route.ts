import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { usage } from "@/modules/m17-dashboards/service";

export const GET = route({ roles: ADMINS }, async ({ ctx }) => ok(await usage(ctx)));
