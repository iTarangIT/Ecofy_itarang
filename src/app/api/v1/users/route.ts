import { route } from "@/core/http/route";
import { created, page } from "@/core/http/envelope";
import { ADMINS } from "@/core/auth/rbac";
import { listUsers, inviteUser } from "@/modules/m01-access/service";
import { UserInvite, PageQuery } from "@/modules/m01-access/schemas";

export const GET = route({ roles: ADMINS, query: PageQuery }, async ({ ctx, query }) => {
  const r = await listUsers(ctx, query);
  return page(r.data, r.meta);
});
export const POST = route({ roles: ADMINS, body: UserInvite }, async ({ ctx, body }) => created(await inviteUser(ctx, body)));
