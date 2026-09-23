import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ALL_ROLES, ITARANG_ROLES } from "@/core/auth/rbac";
import { listOffers, createOffer } from "@/modules/m09-offer/service";
import { OfferCreate } from "@/modules/m09-offer/schemas";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await listOffers(ctx, params.caseId)));
export const POST = route({ roles: ITARANG_ROLES, body: OfferCreate, idempotent: true }, async ({ ctx, params, body }) => created(await createOffer(ctx, params.caseId, body.quoteId)));
