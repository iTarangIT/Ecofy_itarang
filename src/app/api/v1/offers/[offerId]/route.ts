import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { getOffer } from "@/modules/m09-offer/service";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await getOffer(ctx, params.offerId)));
