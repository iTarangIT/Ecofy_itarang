import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ALL_ROLES, ITARANG_ROLES } from "@/core/auth/rbac";
import { listAppointments, bookAppointment } from "@/modules/m06-followup/service";
import { AppointmentCreate } from "@/modules/m06-followup/schemas";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await listAppointments(ctx, params.caseId)));
export const POST = route({ roles: ITARANG_ROLES, body: AppointmentCreate }, async ({ ctx, params, body }) => created(await bookAppointment(ctx, params.caseId, body)));
