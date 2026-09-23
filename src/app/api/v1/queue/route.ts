import { route } from "@/core/http/route";
import { page } from "@/core/http/envelope";
import { queue } from "@/modules/m05-queue/service";
import { PageQuery } from "@/modules/m01-access/schemas";

export const GET = route({ roles: ["ITARANG_ADMIN"], query: PageQuery }, async ({ ctx, query }) => { const r = await queue(ctx, query); return page(r.data, r.meta); });
