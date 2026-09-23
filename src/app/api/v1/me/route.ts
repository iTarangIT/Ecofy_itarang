import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { me } from "@/modules/m01-access/service";

export const GET = route({ roles: ALL_ROLES, device: "session-only" }, async ({ ctx }) => ok(me(ctx)));
