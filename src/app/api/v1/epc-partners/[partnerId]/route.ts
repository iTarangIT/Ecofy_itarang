import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { patchEpcPartner } from "@/modules/m02-settings/service";
import { EpcPartnerPatch } from "@/modules/m02-settings/schemas";

export const PATCH = route({ roles: ["ITARANG_ADMIN"], body: EpcPartnerPatch }, async ({ ctx, params, body }) => ok(await patchEpcPartner(ctx, params.partnerId, body)));
