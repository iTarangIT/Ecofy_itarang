import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { revokeDevices } from "@/modules/m01-access/service";
import { Reason } from "@/modules/m01-access/schemas";

export const POST = route({ roles: ["ITARANG_ADMIN"], body: Reason }, async ({ ctx, params, body }) => { await revokeDevices(ctx, params.userId, body.reason); return empty(200); });
