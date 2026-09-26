import { route } from "@/core/http/route";
import { accepted } from "@/core/http/envelope";
import { IMPORTERS } from "@/core/auth/rbac";
import { commitImport } from "@/modules/m03-intake/service";
import { ImportCommit } from "@/modules/m03-intake/schemas";

export const POST = route({ roles: IMPORTERS, body: ImportCommit, idempotent: true }, async ({ ctx, params, body }) => accepted(await commitImport(ctx, params.importId, body)));
