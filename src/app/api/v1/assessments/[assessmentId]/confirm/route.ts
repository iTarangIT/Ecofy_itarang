import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { confirmAssessment } from "@/modules/m07-assessment/service";

export const POST = route({ roles: ITARANG_ROLES, ifMatch: true }, async ({ ctx, params, ifMatch }) => ok(await confirmAssessment(ctx, params.assessmentId, ifMatch)));
