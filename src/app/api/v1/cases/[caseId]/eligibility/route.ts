import { route } from "@/core/http/route";
import { created, ok } from "@/core/http/envelope";
import { ALL_ROLES, ITARANG_ROLES } from "@/core/auth/rbac";
import { latestEligibility, sendForEligibility } from "@/modules/m09-offer/service";
import { EligibilityRequest } from "@/modules/m09-offer/schemas";

export const POST = route({ roles: ITARANG_ROLES, body: EligibilityRequest }, async ({ ctx, params, body }) => created(await sendForEligibility(ctx, params.caseId, body)));
export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await latestEligibility(ctx, params.caseId)));
