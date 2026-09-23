import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { setTemperature } from "@/modules/m04-qualify/service";
import { TemperatureSet } from "@/modules/m04-qualify/schemas";

export const POST = route({ roles: ["ECOFY_USER", "ECOFY_ADMIN"], body: TemperatureSet, ifMatch: true }, async ({ ctx, params, body, ifMatch }) => ok(await setTemperature(ctx, params.caseId, ifMatch, body)));
