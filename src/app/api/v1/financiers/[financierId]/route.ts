import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { patchFinancier } from "@/modules/m02-settings/service";
import { FinancierPatch } from "@/modules/m02-settings/schemas";

export const PATCH = route({ roles: ["ITARANG_ADMIN"], body: FinancierPatch }, async ({ ctx, params, body }) => ok(await patchFinancier(ctx, params.financierId, body)));
