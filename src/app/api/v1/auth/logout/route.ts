import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { clearedSessionCookies } from "@/core/auth/cookies";
import { logout } from "@/modules/m01-access/service";

export const POST = route({ roles: ALL_ROLES, device: "session-only" }, async ({ ctx, cookies }) => {
  await logout(ctx);
  cookies.push(...clearedSessionCookies());
  return empty(200);
});
