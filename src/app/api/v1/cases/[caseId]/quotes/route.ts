import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ALL_ROLES, ITARANG_ROLES } from "@/core/auth/rbac";
import { listQuotes, createQuote } from "@/modules/m09-offer/service";
import { QuoteCreate } from "@/modules/m09-offer/schemas";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await listQuotes(ctx, params.caseId)));
export const POST = route({ roles: ITARANG_ROLES, body: QuoteCreate, idempotent: true }, async ({ ctx, params, body }) => created(await createQuote(ctx, params.caseId, body)));
