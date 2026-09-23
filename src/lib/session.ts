import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveTenant, normaliseHost } from "@/core/auth/tenant";
import { authenticate } from "@/core/auth/session";
import { PERMISSIONS, type Role } from "@/core/auth/rbac";
import { AppError } from "@/core/http/errors";
import { config } from "@/core/config";

export type SessionInfo = { userId: string; fullName: string; email: string; role: Role; org: "ECOFY" | "ITARANG"; permissions: string[]; tenantId: string };

/**
 * Server-side session for (app) layouts and pages (Node runtime). Redirects to /login when the
 * caller is not signed in, and to the device step when the device is untrusted.
 */
export async function requireSession(): Promise<SessionInfo> {
  const c = config();
  const h = await headers();
  const ck = await cookies();
  const tenantId = await resolveTenant(normaliseHost(h.get("host")));
  if (!tenantId) redirect("/login?reason=TENANT");
  try {
    const a = await authenticate(tenantId, { access: ck.get(c.SESSION_COOKIE_NAME)?.value ?? null, refresh: ck.get(c.REFRESH_COOKIE_NAME)?.value ?? null, device: ck.get(c.DEVICE_COOKIE_NAME)?.value ?? null });
    if (!a.deviceTrusted) redirect("/login?step=device");
    return { userId: a.auth.userId, fullName: a.auth.fullName, email: a.auth.email, role: a.auth.role, org: a.auth.org, permissions: PERMISSIONS[a.auth.role], tenantId };
  } catch (e) {
    if (e instanceof AppError) redirect(`/login?reason=${e.code}`);
    throw e;
  }
}

export function can(s: SessionInfo, permission: string) {
  return s.permissions.includes(permission);
}
