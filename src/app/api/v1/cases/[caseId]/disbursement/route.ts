import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { recordDisbursement } from "@/modules/m12-installation/service";
import { Disbursement } from "@/modules/m12-installation/schemas";

export const POST = route({ roles: ADMINS, body: Disbursement, ifMatch: true }, async ({ ctx, params, body, ifMatch }) => created(await recordDisbursement(ctx, params.caseId, ifMatch, body)));
