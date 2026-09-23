import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { triggerReacceptance } from "@/modules/m11-financing/service";
import { Reacceptance } from "@/modules/m11-financing/schemas";

export const POST = route({ roles: ["ECOFY_ADMIN"], body: Reacceptance, idempotent: true }, async ({ ctx, params, body, req }) => created(await triggerReacceptance(ctx, params.caseId, body.decisionId, req.headers.get("idempotency-key") ?? "")));
