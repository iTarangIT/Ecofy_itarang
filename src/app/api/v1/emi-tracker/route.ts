import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { emiTracker } from "@/modules/m13-asset/service";
import { EmiTrackerQuery } from "@/modules/m13-asset/schemas";

/** GET /emi-tracker — CONFLICTS #32: every asset the caller may see with its latest EMI status (DPD band). */
export const GET = route({ roles: ADMINS, query: EmiTrackerQuery }, async ({ ctx, query }) => {
  const rows = await emiTracker(ctx, query);
  return ok(rows, { meta: { count: rows.length } });
});
