import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { updateInstallation } from "@/modules/m12-installation/service";
import { InstallationUpdate } from "@/modules/m12-installation/schemas";

export const PATCH = route({ roles: ITARANG_ROLES, body: InstallationUpdate }, async ({ ctx, params, body }) => ok(await updateInstallation(ctx, params.installationId, body)));
