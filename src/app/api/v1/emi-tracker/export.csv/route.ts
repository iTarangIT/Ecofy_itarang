import { z } from "zod";
import { route } from "@/core/http/route";
import { raw } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { emiTrackerCsv } from "@/modules/m13-asset/service";
import { EmiTrackerQuery } from "@/modules/m13-asset/schemas";

const Q = EmiTrackerQuery.extend({ scope: z.enum(["latest", "history"]).optional() });

/** GET /emi-tracker/export.csv — the filtered tracker as CSV (`scope=history` for every recorded status). Logged like /reports. */
export const GET = route({ roles: ADMINS, query: Q }, async ({ ctx, query }) => {
  const { scope, ...filters } = query;
  const csv = await emiTrackerCsv(ctx, filters, scope ?? "latest");
  const name = `emi-tracker-${scope ?? "latest"}-${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(ctx.now)}.csv`;
  return raw(new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` } }));
});
