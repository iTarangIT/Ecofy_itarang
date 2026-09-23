import { z } from "zod";
import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { userStats } from "@/modules/m17-dashboards/service";

const Q = z.object({ from: z.string().optional(), to: z.string().optional() });
export const GET = route({ roles: ALL_ROLES, query: Q }, async ({ ctx, params, query }) => ok(await userStats(ctx, params.userId, query)));
