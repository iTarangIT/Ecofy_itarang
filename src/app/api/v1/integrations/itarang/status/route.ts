import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { status } from "@/modules/m18-crm-sync/admin";

/** GET /integrations/itarang/status — Admin › Integration (docs/CONFLICTS.md #24). Never includes the secret. */
export const GET = route({ roles: ADMINS }, async ({ ctx }) => ok(await status(ctx)));
