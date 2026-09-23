import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { decideEligibility } from "@/modules/m09-offer/service";
import { EligibilityDecision } from "@/modules/m09-offer/schemas";

export const POST = route({ roles: ADMINS, body: EligibilityDecision }, async ({ ctx, params, body }) => { await decideEligibility(ctx, params.eligibilityId, body); return empty(200); });
