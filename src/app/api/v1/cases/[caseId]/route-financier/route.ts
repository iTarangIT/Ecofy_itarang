import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { routeFinancier } from "@/modules/m11-financing/service";
import { RouteFinancier } from "@/modules/m11-financing/schemas";

export const POST = route({ roles: ["ITARANG_ADMIN"], body: RouteFinancier, ifMatch: true }, async ({ ctx, params, body, ifMatch }) => ok(await routeFinancier(ctx, params.caseId, ifMatch, body)));
