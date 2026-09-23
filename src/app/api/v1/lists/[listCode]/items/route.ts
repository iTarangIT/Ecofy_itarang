import { z } from "zod";
import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { listItems, createListItem } from "@/modules/m02-settings/service";
import { ListItemCreate } from "@/modules/m02-settings/schemas";

const Q = z.object({ active: z.enum(["true", "false"]).optional() });
export const GET = route({ roles: ALL_ROLES, query: Q }, async ({ ctx, params, query }) => ok(await listItems(ctx, params.listCode, query.active !== "true")));
export const POST = route({ roles: ["ITARANG_ADMIN"], body: ListItemCreate }, async ({ ctx, params, body }) => created(await createListItem(ctx, params.listCode, body)));
