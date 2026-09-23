import { route } from "@/core/http/route";
import { page, created } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { listFinanciers, createFinancier } from "@/modules/m02-settings/service";
import { FinancierIn } from "@/modules/m02-settings/schemas";
import { PageQuery } from "@/modules/m01-access/schemas";

export const GET = route({ roles: ADMINS, query: PageQuery }, async ({ ctx, query }) => { const r = await listFinanciers(ctx, query); return page(r.data, r.meta); });
export const POST = route({ roles: ["ITARANG_ADMIN"], body: FinancierIn }, async ({ ctx, body }) => created(await createFinancier(ctx, body)));
