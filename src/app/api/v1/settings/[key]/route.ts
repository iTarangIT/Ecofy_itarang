import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { patchSetting } from "@/modules/m02-settings/service";
import { SettingPatch } from "@/modules/m02-settings/schemas";

export const PATCH = route({ roles: ["ITARANG_ADMIN"], body: SettingPatch }, async ({ ctx, params, body }) => { await patchSetting(ctx, params.key, body.value, body.reason); return empty(200); });
