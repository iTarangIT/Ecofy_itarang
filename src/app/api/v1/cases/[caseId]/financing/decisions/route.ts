import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS, ALL_ROLES } from "@/core/auth/rbac";
import { listDecisions, recordDecision } from "@/modules/m11-financing/service";
import { FinancingDecision } from "@/modules/m11-financing/schemas";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await listDecisions(ctx, params.caseId)));
export const POST = route({ roles: ADMINS, body: FinancingDecision, ifMatch: true }, async ({ ctx, params, body, ifMatch }) => ok(await recordDecision(ctx, params.caseId, ifMatch, body)));
