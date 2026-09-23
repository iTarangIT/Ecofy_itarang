import { route } from "@/core/http/route";
import { raw } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { reportCsv } from "@/modules/m17-dashboards/service";

/** GET /reports/{code}.csv — Next cannot split "[code].csv", so the segment carries the suffix and it is stripped here. */
export const GET = route({ roles: ADMINS }, async ({ ctx, params, req }) => {
  const code = params.code.replace(/\.csv$/i, "");
  const filters: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (filters[k] = v));
  const csv = await reportCsv(ctx, code, filters);
  return raw(new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="' + code + '.csv"' } }));
});
