import { z } from "zod";
import { route } from "@/core/http/route";
import { page, created } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { listEpcPartners, createEpcPartner } from "@/modules/m02-settings/service";
import { EpcPartnerIn } from "@/modules/m02-settings/schemas";

const Q = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional(), active: z.enum(["true", "false"]).optional() });
export const GET = route({ roles: ALL_ROLES, query: Q }, async ({ ctx, query }) => { const r = await listEpcPartners(ctx, { cursor: query.cursor, limit: query.limit, activeOnly: query.active === "true" }); return page(r.data, r.meta); });
export const POST = route({ roles: ["ITARANG_ADMIN"], body: EpcPartnerIn }, async ({ ctx, body }) => created(await createEpcPartner(ctx, body)));
