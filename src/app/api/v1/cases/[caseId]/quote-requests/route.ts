import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { createQuoteRequest } from "@/modules/m09-offer/service";
import { QuoteRequestCreate } from "@/modules/m09-offer/schemas";

export const POST = route({ roles: ITARANG_ROLES, body: QuoteRequestCreate }, async ({ ctx, params, body }) => created(await createQuoteRequest(ctx, params.caseId, body)));
