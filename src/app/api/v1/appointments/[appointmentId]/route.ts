import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { updateAppointment } from "@/modules/m06-followup/service";
import { AppointmentUpdate } from "@/modules/m06-followup/schemas";

export const PATCH = route({ roles: ITARANG_ROLES, body: AppointmentUpdate }, async ({ ctx, params, body }) => ok(await updateAppointment(ctx, params.appointmentId, body)));
