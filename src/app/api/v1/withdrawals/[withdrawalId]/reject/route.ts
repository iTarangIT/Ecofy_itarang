import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { rejectWithdrawal } from "@/modules/m14-withdrawal/service";
import { Reason } from "@/modules/m01-access/schemas";

export const POST = route({ roles: ["ITARANG_ADMIN"], body: Reason }, async ({ ctx, params, body }) => { await rejectWithdrawal(ctx, params.withdrawalId, body.reason); return empty(200); });
