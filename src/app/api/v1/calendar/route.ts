import { route } from "@/core/http/route";
import { ok, empty } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { getCalendar, putCalendar } from "@/modules/m02-settings/service";
import { CalendarPut } from "@/modules/m02-settings/schemas";

export const GET = route({ roles: ADMINS }, async ({ ctx }) => ok(await getCalendar(ctx)));
export const PUT = route({ roles: ["ITARANG_ADMIN"], body: CalendarPut }, async ({ ctx, body }) => { await putCalendar(ctx, body); return empty(200); });
