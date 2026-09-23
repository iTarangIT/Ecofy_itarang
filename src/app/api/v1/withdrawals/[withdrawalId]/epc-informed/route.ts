import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { markEpcInformed } from "@/modules/m14-withdrawal/service";

export const POST = route({ roles: ["ITARANG_ADMIN"] }, async ({ ctx, params }) => ok(await markEpcInformed(ctx, params.withdrawalId)));
