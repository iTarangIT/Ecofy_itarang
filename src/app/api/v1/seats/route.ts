import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { listSeats } from "@/modules/m01-access/service";

export const GET = route({ roles: ["ITARANG_ADMIN"] }, async ({ ctx }) => ok(await listSeats(ctx)));
