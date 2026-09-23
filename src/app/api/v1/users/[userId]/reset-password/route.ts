import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { resetPassword } from "@/modules/m01-access/service";

export const POST = route({ roles: ADMINS }, async ({ ctx, params }) => { await resetPassword(ctx, params.userId); return empty(200); });
