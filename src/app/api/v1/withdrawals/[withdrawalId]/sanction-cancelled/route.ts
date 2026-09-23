import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { markSanctionCancelled } from "@/modules/m14-withdrawal/service";

export const POST = route({ roles: ["ECOFY_ADMIN"] }, async ({ ctx, params }) => ok(await markSanctionCancelled(ctx, params.withdrawalId)));
