import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { startUpload } from "@/modules/m15-documents/service";
import { FileUploadStart } from "@/modules/m15-documents/schemas";

export const POST = route({ roles: ALL_ROLES, body: FileUploadStart }, async ({ ctx, params, body }) => created(await startUpload(ctx, params.caseId, body)));
