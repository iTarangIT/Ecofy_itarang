import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { recordDownPayment, listDownPayments } from "@/modules/m12-installation/service";
import { DownPayment } from "@/modules/m12-installation/schemas";

export const GET = route({ roles: ADMINS }, async ({ ctx, params }) => ok(await listDownPayments(ctx, params.caseId)));
export const POST = route({ roles: ADMINS, body: DownPayment }, async ({ ctx, params, body }) => created(await recordDownPayment(ctx, params.caseId, body)));
