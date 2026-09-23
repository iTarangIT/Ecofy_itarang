import type { Role, OrgKind } from "@/core/auth/rbac";
import type { Tx } from "@/core/db/client";

/** Who is calling, resolved once per request by the route wrapper. */
export type AuthContext = {
  tenantId: string;
  userId: string;
  role: Role;
  org: OrgKind;
  orgId: string;
  email: string;
  fullName: string;
  sessionId: string;
};

/** Everything a service needs; passed explicitly (no globals). */
export type RequestContext = {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  auth: AuthContext;
  tx: Tx;
  now: Date;
};

/** Platform (worker) context: no user, tenant-wide. */
export type SystemContext = {
  requestId: string;
  tenantId: string;
  tx: Tx;
  now: Date;
};

export type ActorContext = RequestContext | SystemContext;

export function isRequestContext(c: ActorContext): c is RequestContext {
  return (c as RequestContext).auth !== undefined;
}

export function tenantOf(c: ActorContext): string {
  return isRequestContext(c) ? c.auth.tenantId : c.tenantId;
}

export function actorOf(c: ActorContext): { id: string | null; role: Role | null } {
  return isRequestContext(c) ? { id: c.auth.userId, role: c.auth.role } : { id: null, role: null };
}
