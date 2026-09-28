import { route } from "@/core/http/route";
import { raw } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { emiUploadTemplateCsv } from "@/modules/m13-asset/service";

/** GET /emi-tracker/template.csv — the columns the EMI bulk upload reads (case_no or file_no, as_of, state, note). */
export const GET = route({ roles: ADMINS }, async () =>
  raw(new Response(emiUploadTemplateCsv(), { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="emi-updates-template.csv"' } })));
