import { route } from "@/core/http/route";
import { created } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { startImport } from "@/modules/m03-intake/service";
import { ImportStart } from "@/modules/m03-intake/schemas";

export const POST = route({ roles: ADMINS, body: ImportStart }, async ({ ctx, body }) => created(await startImport(ctx, body)));
