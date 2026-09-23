import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { errors } from "@/core/http/errors";
import { ALL_ROLES } from "@/core/auth/rbac";
import { readCookies } from "@/core/auth/cookies";
import { resendDevice } from "@/modules/m01-access/service";

export const POST = route({ roles: ALL_ROLES, device: "session-only" }, async ({ req, ctx }) => {
  const { device } = readCookies(req);
  if (!device) throw errors.validation("Device cookie missing; sign in again");
  return ok(await resendDevice(ctx, device));
});
