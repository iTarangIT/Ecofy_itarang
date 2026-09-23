import { route } from "@/core/http/route";
import { page } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { financingQueue } from "@/modules/m11-financing/service";
import { PageQuery } from "@/modules/m01-access/schemas";

export const GET = route({ roles: ADMINS, query: PageQuery }, async ({ ctx, query }) => { const r = await financingQueue(ctx, query); return page(r.data, r.meta); });
