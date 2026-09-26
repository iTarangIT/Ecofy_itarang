import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { verifyOtp } from "@/modules/m10-acceptance/service";
import { OtpVerify } from "@/modules/m10-acceptance/schemas";

/** iTarang verifies the customer's code; Ecofy Admin may verify a REACCEPTANCE code only (CONFLICTS #28, enforced in the service). */
export const POST = route({ roles: [...ITARANG_ROLES, "ECOFY_ADMIN"], body: OtpVerify }, async ({ ctx, params, body }) => ok(await verifyOtp(ctx, params.challengeId, body.code)));
