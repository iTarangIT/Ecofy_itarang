import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { errors } from "@/core/http/errors";
import { retryDelivery } from "@/modules/m18-crm-sync/admin";

/** POST /integrations/itarang/deliveries/{deliveryId}/retry — re-queue a DEAD or waiting delivery. */
export const POST = route({ roles: ADMINS }, async ({ ctx, params }) => {
  const id = Number(params.deliveryId);
  if (!Number.isInteger(id) || id < 1) throw errors.validation("deliveryId must be a positive integer");
  return ok(await retryDelivery(ctx, id));
});
