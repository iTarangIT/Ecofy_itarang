import { route } from "@/core/http/route";
import { page, created } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { listCases, getCase } from "@/modules/m04-qualify/service";
import { createSingleCase } from "@/modules/m03-intake/service";
import { CaseListQuery } from "@/modules/m04-qualify/schemas";
import { CaseCreate } from "@/modules/m03-intake/schemas";

export const GET = route({ roles: ALL_ROLES, query: CaseListQuery }, async ({ ctx, query }) => { const r = await listCases(ctx, query); return page(r.data, r.meta); });
export const POST = route({ roles: ["ECOFY_USER", "ECOFY_ADMIN", "ITARANG_ADMIN"], body: CaseCreate, idempotent: true }, async ({ ctx, body }) => {
  const out = await createSingleCase(ctx, body);
  return created(await getCase(ctx, out.caseId));
});
