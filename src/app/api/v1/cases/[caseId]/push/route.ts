import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { pushToItarang } from "@/modules/m04-qualify/service";
import { Note } from "@/modules/m01-access/schemas";

export const POST = route({ roles: ["ECOFY_USER", "ECOFY_ADMIN"], body: Note, ifMatch: true }, async ({ ctx, params, body, ifMatch }) => ok(await pushToItarang(ctx, params.caseId, ifMatch, body)));
