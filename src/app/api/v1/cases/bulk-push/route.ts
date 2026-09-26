import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { bulkPush } from "@/modules/m04-qualify/service";
import { BulkPush } from "@/modules/m04-qualify/schemas";

/** POST /cases/bulk-push (docs/CONFLICTS.md #26): pushes each selected Warm S0 lead; reports the ones skipped and why. */
export const POST = route({ roles: ["ECOFY_USER", "ECOFY_ADMIN"], body: BulkPush }, async ({ ctx, body }) => ok(await bulkPush(ctx, body)));
