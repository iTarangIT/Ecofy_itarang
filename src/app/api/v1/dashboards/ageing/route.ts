import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { ageing } from "@/modules/m17-dashboards/service";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx }) => ok(await ageing(ctx)));
