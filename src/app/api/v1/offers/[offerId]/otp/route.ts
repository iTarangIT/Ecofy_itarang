import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { sendOfferOtp } from "@/modules/m10-acceptance/service";

export const POST = route({ roles: ITARANG_ROLES, ifMatch: true, idempotent: true }, async ({ ctx, params, ifMatch, req }) => created(await sendOfferOtp(ctx, params.offerId, ifMatch, req.headers.get("idempotency-key") ?? "")));
