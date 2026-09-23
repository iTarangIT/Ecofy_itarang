import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { errors } from "@/core/http/errors";
import { ALL_ROLES } from "@/core/auth/rbac";
import { readCookies } from "@/core/auth/cookies";
import { verifyDevice } from "@/modules/m01-access/service";
import { DeviceVerify } from "@/modules/m01-access/schemas";

export const POST = route({ roles: ALL_ROLES, device: "session-only", body: DeviceVerify }, async ({ req, body, ctx }) => {
  const { device } = readCookies(req);
  if (!device) throw errors.validation("Device cookie missing; sign in again");
  return ok(await verifyDevice(ctx, device, body.code));
});
