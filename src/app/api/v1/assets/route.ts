import { z } from "zod";
import { route } from "@/core/http/route";
import { page } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { listAssets } from "@/modules/m13-asset/service";

const Q = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional(), status: z.string().optional() });
export const GET = route({ roles: ADMINS, query: Q }, async ({ ctx, query }) => { const r = await listAssets(ctx, query); return page(r.data, r.meta); });
