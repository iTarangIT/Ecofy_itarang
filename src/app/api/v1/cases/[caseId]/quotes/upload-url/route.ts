import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { ITARANG_ROLES } from "@/core/auth/rbac";
import { quoteUploadUrl } from "@/modules/m09-offer/service";
import { FileUploadStart } from "@/modules/m15-documents/schemas";

export const POST = route({ roles: ITARANG_ROLES, body: FileUploadStart }, async ({ ctx, params, body }) => created(await quoteUploadUrl(ctx, params.caseId, body)));
