import { and, eq } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { withSystemContext } from "@/core/db/tx";
import { config } from "@/core/config";
import { errors } from "@/core/http/errors";
import type { AuthContext } from "@/core/http/context";
import { ITARANG_ROLES, isRole } from "./rbac";
import { apiSigningString, verify } from "./hmac";

export const ACT_AS_HEADER = "x-itarang-act-as";
export const ACTOR_NAME_HEADER = "x-itarang-actor-name";

/**
 * Machine-to-machine access for the iTarang CRM (docs/ITARANG_CRM_SYNC.md §5, CONFLICTS #24).
 * Instead of cookies, the request carries X-Itarang-Signature over method + path + body (ITARANG_CRM_SECRET).
 * The call runs as a real Ecofy user of the iTarang org: `X-Itarang-Act-As: <email>` (an ACTIVE iTarang
 * Admin or Caller), defaulting to ITARANG_CRM_ACTOR_EMAIL. Everything else is unchanged: the route's
 * x-roles, RLS, gates, If-Match, Idempotency-Key and audit apply exactly as for that user in the UI.
 * Ecofy-org users can never be acted as.
 */
export async function authenticateService(tenantId: string, req: { method: string; pathWithQuery: string; headers: Headers }, rawBody: string, now: Date): Promise<AuthContext> {
  const { ITARANG_CRM_SECRET: secret, ITARANG_CRM_ACTOR_EMAIL: defaultActor } = config();
  if (!secret) throw errors.unauthenticated("Service access is not configured");
  if (!verify(secret, req.headers.get("x-itarang-signature"), apiSigningString(req.method, req.pathWithQuery, rawBody), now)) {
    throw errors.unauthenticated("Bad or expired X-Itarang-Signature");
  }
  const email = (req.headers.get(ACT_AS_HEADER) ?? defaultActor ?? "").trim();
  if (!email) throw errors.unauthenticated("X-Itarang-Act-As is required (no ITARANG_CRM_ACTOR_EMAIL configured)");
  return withSystemContext(tenantId, async (tx) => {
    const u = (await tx.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.email, email))).limit(1))[0];
    if (!u || u.status !== "ACTIVE") throw errors.unauthenticated("Act-as user is not an active user of this tenant");
    if (!isRole(u.role) || !ITARANG_ROLES.includes(u.role)) throw errors.forbidden("Service calls may act only as iTarang users");
    return { tenantId, userId: u.id, role: u.role, org: "ITARANG", orgId: u.orgId, email: u.email, fullName: u.fullName, sessionId: "service:itarang-crm" };
  });
}
