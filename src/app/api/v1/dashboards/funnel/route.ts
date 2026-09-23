import { z } from "zod";
import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { funnel } from "@/modules/m17-dashboards/service";

const Q = z.object({ from: z.string().optional(), to: z.string().optional(), userId: z.string().uuid().optional(), segment: z.enum(["RESI", "ESS", "CI"]).optional() });
export const GET = route({ roles: ALL_ROLES, query: Q }, async ({ ctx, query }) => ok(await funnel(ctx, query)));
