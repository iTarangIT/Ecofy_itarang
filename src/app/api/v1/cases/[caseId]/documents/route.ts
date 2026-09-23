import { route } from "@/core/http/route";
import { ok, created } from "@/core/http/envelope";
import { ALL_ROLES } from "@/core/auth/rbac";
import { listDocuments, commitDocument } from "@/modules/m15-documents/service";
import { DocumentCommit } from "@/modules/m15-documents/schemas";

export const GET = route({ roles: ALL_ROLES }, async ({ ctx, params }) => ok(await listDocuments(ctx, params.caseId)));
export const POST = route({ roles: ALL_ROLES, body: DocumentCommit }, async ({ ctx, params, body }) => created(await commitDocument(ctx, params.caseId, body)));
