import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/core/db/client";
import { withSystemContext } from "@/core/db/tx";
import { verifyAccessToken, decodeExp } from "./jwt";
import { refreshTokens, supabaseConfigured } from "./supabase";
import { deviceHash } from "./cookies";
import { errors } from "@/core/http/errors";
import type { AuthContext } from "@/core/http/context";
import { isRole } from "./rbac";

export type Authenticated = {
  auth: AuthContext;
  /** set when the access token was refreshed during this request */
  rotated?: { accessToken: string; refreshToken: string };
  deviceTrusted: boolean;
};

/**
 * Resolves the caller from the cookies (FR-01.4, FR-01.5):
 *  1. verify the JWT (refresh once if expired and a refresh token exists)
 *  2. load the platform user by auth_user_id (must be ACTIVE)
 *  3. compare the JWT session_id with user_sessions → SESSION_REPLACED
 *  4. check the device cookie against trusted_devices → deviceTrusted
 */
export async function authenticate(tenantId: string, cookies: { access: string | null; refresh: string | null; device: string | null }, now = new Date()): Promise<Authenticated> {
  if (!cookies.access) throw errors.unauthenticated();
  let token = cookies.access;
  let rotated: Authenticated["rotated"];
  const exp = decodeExp(token);
  if (exp !== null && exp * 1000 < now.getTime() && cookies.refresh && supabaseConfigured()) {
    const fresh = await refreshTokens(cookies.refresh.slice(0, 16), cookies.refresh);
    if (!fresh) throw errors.unauthenticated("Session expired");
    token = fresh.accessToken;
    rotated = fresh;
  }
  let claims;
  try {
    claims = await verifyAccessToken(token);
  } catch {
    throw errors.unauthenticated("Invalid session");
  }
  return withSystemContext(tenantId, async (tx) => {
    const user = await loadUserByAuthId(tx, tenantId, claims.sub);
    if (!user) throw errors.unauthenticated("No platform user for this login");
    if (user.status !== "ACTIVE") throw errors.unauthenticated("User is not active");
    const session = await tx.select().from(schema.userSessions).where(eq(schema.userSessions.userId, user.id)).limit(1);
    if (!session[0]) throw errors.unauthenticated("Session not registered");
    if (session[0].sessionId !== claims.session_id) throw errors.sessionReplaced();
    const deviceTrusted = cookies.device ? await isDeviceTrusted(tx, user.id, cookies.device, now) : false;
    if (!isRole(user.role)) throw errors.forbidden("Unknown role");
    const org = await tx.select({ kind: schema.orgs.kind }).from(schema.orgs).where(eq(schema.orgs.id, user.orgId)).limit(1);
    return {
      auth: {
        tenantId,
        userId: user.id,
        role: user.role,
        org: org[0]?.kind ?? (user.role.startsWith("ECOFY") ? "ECOFY" : "ITARANG"),
        orgId: user.orgId,
        email: user.email,
        fullName: user.fullName,
        sessionId: claims.session_id,
      },
      rotated,
      deviceTrusted,
    };
  });
}

export async function loadUserByAuthId(tx: Tx, tenantId: string, authUserId: string) {
  const rows = await tx.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.authUserId, authUserId))).limit(1);
  return rows[0] ?? null;
}

export async function isDeviceTrusted(tx: Tx, userId: string, cookieValue: string, now: Date): Promise<boolean> {
  const hash = deviceHash(cookieValue);
  const rows = await tx
    .select({ status: schema.trustedDevices.status, trustedUntil: schema.trustedDevices.trustedUntil })
    .from(schema.trustedDevices)
    .where(and(eq(schema.trustedDevices.userId, userId), eq(schema.trustedDevices.deviceHash, hash)))
    .limit(1);
  const d = rows[0];
  if (!d || d.status !== "TRUSTED" || !d.trustedUntil) return false;
  return new Date(d.trustedUntil).getTime() > now.getTime();
}
