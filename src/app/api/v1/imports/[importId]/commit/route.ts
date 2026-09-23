import { route } from "@/core/http/route";
import { accepted } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { commitImport } from "@/modules/m03-intake/service";
import { ImportCommit } from "@/modules/m03-intake/schemas";

export const POST = route({ roles: ADMINS, body: ImportCommit, idempotent: true }, async ({ ctx, params, body }) => accepted(await commitImport(ctx, params.importId, body)));
