import fs from "node:fs/promises";
import path from "node:path";
import { route } from "@/core/http/route";
import { raw } from "@/core/http/envelope";
import { IMPORTERS } from "@/core/auth/rbac";

/** FR-03.1: lead upload template v0.3 (verbatim from the handoff, served from public/templates). */
export const GET = route({ roles: IMPORTERS }, async () => {
  const file = await fs.readFile(path.join(process.cwd(), "public", "templates", "Ecofy_Lead_Upload_Template_v0.3.xlsx"));
  return raw(new Response(new Uint8Array(file), { status: 200, headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": 'attachment; filename="Ecofy_Lead_Upload_Template_v0.3.xlsx"' } }));
});
