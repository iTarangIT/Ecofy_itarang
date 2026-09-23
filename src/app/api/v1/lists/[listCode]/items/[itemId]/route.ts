import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { patchListItem } from "@/modules/m02-settings/service";
import { ListItemPatch } from "@/modules/m02-settings/schemas";

export const PATCH = route({ roles: ["ITARANG_ADMIN"], body: ListItemPatch }, async ({ ctx, params, body }) => ok(await patchListItem(ctx, params.listCode, params.itemId, body)));
