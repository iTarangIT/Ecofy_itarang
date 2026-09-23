import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { advanceToAssessment } from "@/modules/m06-followup/service";

export const POST = route({ roles: ITARANG_ROLES, ifMatch: true }, async ({ ctx, params, ifMatch }) => ok(await advanceToAssessment(ctx, params.caseId, ifMatch)));
