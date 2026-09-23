import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { bulkAssign } from "@/modules/m04-qualify/service";
import { BulkAssign } from "@/modules/m04-qualify/schemas";

export const POST = route({ roles: ADMINS, body: BulkAssign }, async ({ ctx, body }) => ok(await bulkAssign(ctx, body)));
