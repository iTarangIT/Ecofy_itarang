import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { reopenCase } from "@/modules/m04-qualify/service";
import { Reason } from "@/modules/m01-access/schemas";

export const POST = route({ roles: ["ITARANG_ADMIN"], body: Reason, ifMatch: true }, async ({ ctx, params, body, ifMatch }) => ok(await reopenCase(ctx, params.caseId, ifMatch, body.reason)));
