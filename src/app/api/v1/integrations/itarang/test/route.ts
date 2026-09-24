import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { sendTest } from "@/modules/m18-crm-sync/admin";

/** POST /integrations/itarang/test — sends a signed `ping` to the configured CRM URL and reports the answer. */
export const POST = route({ roles: ADMINS }, async ({ ctx }) => ok(await sendTest(ctx)));
