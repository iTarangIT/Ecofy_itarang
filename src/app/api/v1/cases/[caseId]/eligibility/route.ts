import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { sendForEligibility } from "@/modules/m09-offer/service";
import { EligibilityRequest } from "@/modules/m09-offer/schemas";

export const POST = route({ roles: ITARANG_ROLES, body: EligibilityRequest }, async ({ ctx, params, body }) => created(await sendForEligibility(ctx, params.caseId, body)));
