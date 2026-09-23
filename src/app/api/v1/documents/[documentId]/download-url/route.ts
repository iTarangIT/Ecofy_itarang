import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { downloadUrl } from "@/modules/m15-documents/service";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await downloadUrl(ctx, params.documentId)));
