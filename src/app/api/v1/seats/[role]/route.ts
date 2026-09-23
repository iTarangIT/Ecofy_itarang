import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { patchSeat } from "@/modules/m01-access/service";
import { SeatLimitPatch } from "@/modules/m01-access/schemas";

export const PATCH = route({ roles: ["ITARANG_ADMIN"], body: SeatLimitPatch }, async ({ ctx, params, body }) => { await patchSeat(ctx, params.role, body.seatLimit, body.reason); return empty(200); });
