import { z } from "zod";
import { route } from "@/core/http/route";
import { page } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { searchAudit } from "@/modules/m18-audit/service";

const Q = z.object({ caseId: z.string().uuid().optional(), userId: z.string().uuid().optional(), action: z.string().optional(), from: z.string().optional(), to: z.string().optional(), cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });
export const GET = route({ roles: ADMINS, query: Q }, async ({ ctx, query }) => { const r = await searchAudit(ctx, query); return page(r.data, r.meta); });
