import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ALL_ROLES, ITARANG_ROLES } from "@/core/auth/rbac";
import { getInstallation, createInstallation } from "@/modules/m12-installation/service";
import { InstallationCreate } from "@/modules/m12-installation/schemas";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await getInstallation(ctx, params.caseId)));
export const POST = route({ roles: ITARANG_ROLES, body: InstallationCreate }, async ({ ctx, params, body }) => created(await createInstallation(ctx, params.caseId, body)));
