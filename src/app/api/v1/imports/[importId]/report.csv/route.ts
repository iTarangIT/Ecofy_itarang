import { route } from "@/core/http/route";
import { raw } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { importReportCsv } from "@/modules/m03-intake/service";

export const GET = route({ roles: ADMINS }, async ({ ctx, params }) => {
  const csv = await importReportCsv(ctx, params.importId);
  return raw(new Response(csv, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="import-' + params.importId + '-report.csv"' } }));
});
