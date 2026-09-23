import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { paymentStatus } from "@/modules/m12-installation/service";

/** Additive: status only (recorded / not recorded), no amounts. */
export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await paymentStatus(ctx, params.caseId)));
