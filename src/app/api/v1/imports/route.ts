import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { IMPORTERS } from "@/core/auth/rbac";
import { startImport } from "@/modules/m03-intake/service";
import { ImportStart } from "@/modules/m03-intake/schemas";

export const POST = route({ roles: IMPORTERS, body: ImportStart }, async ({ ctx, body }) => created(await startImport(ctx, body)));
