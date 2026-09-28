import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { uploadEmiStatuses } from "@/modules/m13-asset/service";
import { EmiUpload } from "@/modules/m13-asset/schemas";

/** POST /emi-tracker/upload — CONFLICTS #32: Ecofy Admin bulk-records EMI statuses per lead; each row is its own savepoint. */
export const POST = route({ roles: ["ECOFY_ADMIN"], body: EmiUpload }, async ({ ctx, body }) => ok(await uploadEmiStatuses(ctx, body)));
