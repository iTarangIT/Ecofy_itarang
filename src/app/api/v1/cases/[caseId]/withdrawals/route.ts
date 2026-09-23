import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ALL_ROLES, ITARANG_ROLES } from "@/core/auth/rbac";
import { listWithdrawals, requestWithdrawal } from "@/modules/m14-withdrawal/service";
import { Reason } from "@/modules/m01-access/schemas";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await listWithdrawals(ctx, params.caseId)));
export const POST = route({ roles: ITARANG_ROLES, body: Reason }, async ({ ctx, params, body }) => created(await requestWithdrawal(ctx, params.caseId, body.reason)));
