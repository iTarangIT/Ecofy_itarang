import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { returnToEcofy } from "@/modules/m05-queue/service";
import { Return } from "@/modules/m04-qualify/schemas";

export const POST = route({ roles: ["ITARANG_ADMIN"], body: Return, ifMatch: true }, async ({ ctx, params, body, ifMatch }) => ok(await returnToEcofy(ctx, params.caseId, ifMatch, body)));
