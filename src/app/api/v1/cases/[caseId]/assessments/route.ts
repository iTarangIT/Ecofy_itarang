import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { listAssessments, saveAssessment } from "@/modules/m07-assessment/service";
import { AssessmentCreate } from "@/modules/m07-assessment/schemas";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await listAssessments(ctx, params.caseId)));
export const POST = route({ roles: ["ECOFY_USER", "ITARANG_CALLER", "ITARANG_ADMIN"], body: AssessmentCreate }, async ({ ctx, params, body }) => created(await saveAssessment(ctx, params.caseId, body)));
