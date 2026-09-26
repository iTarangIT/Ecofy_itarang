import { route } from "@/core/http/route";
import { created, ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { liveReacceptanceChallenge } from "@/modules/m10-acceptance/service";
import { triggerReacceptance } from "@/modules/m11-financing/service";
import { Reacceptance } from "@/modules/m11-financing/schemas";

export const POST = route({ roles: ["ECOFY_ADMIN"], body: Reacceptance, idempotent: true }, async ({ ctx, params, body, req }) => created(await triggerReacceptance(ctx, params.caseId, body.decisionId, req.headers.get("idempotency-key") ?? "")));

/** The live re-acceptance challenge (or null) so the Offer tab can verify the customer's code at S6. */
export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await liveReacceptanceChallenge(ctx, params.caseId)));
