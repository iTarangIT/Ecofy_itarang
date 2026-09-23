import { route } from "@/core/http/route";
import { empty } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { softDelete } from "@/modules/m15-documents/service";
import { Reason } from "@/modules/m01-access/schemas";

export const DELETE = route({ roles: ADMINS, body: Reason }, async ({ ctx, params, body }) => { await softDelete(ctx, params.documentId, body.reason); return empty(200); });
