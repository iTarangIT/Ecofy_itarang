import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { patchQuoteRequest } from "@/modules/m09-offer/service";
import { QuoteRequestPatch } from "@/modules/m09-offer/schemas";

export const PATCH = route({ roles: ITARANG_ROLES, body: QuoteRequestPatch }, async ({ ctx, params, body }) => { await patchQuoteRequest(ctx, params.quoteRequestId, body.status); return empty(200); });
