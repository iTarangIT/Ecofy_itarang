import { and, eq, gt, isNull, sql, desc, lt } from "drizzle-orm";
import { createHash, randomInt } from "node:crypto";
import { schema, type Tx } from "@/core/db/client";
import { withSystemContext, withDbContext } from "@/core/db/tx";
import { verifyAccessToken } from "@/core/auth/jwt";
import { admin as supabaseAdmin, supabaseConfigured } from "@/core/auth/supabase";
import { deviceHash } from "@/core/auth/cookies";
import { errors } from "@/core/http/errors";
import { getSetting } from "@/core/settings/settingsCache";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { mailer } from "@/adapters";
import { config } from "@/core/config";
import { PERMISSIONS, isRole, orgOf, type Role } from "@/core/auth/rbac";
import type { RequestContext, SystemContext } from "@/core/http/context";
import { encodeCursor, decodeCursor } from "@/core/http/serialize";
import type { UserInviteT, UserPatchT } from "./schemas";

export type SessionState = { status: "ACTIVE" | "DEVICE_OTP_SENT"; otpExpiresAt?: Date; resendAfterSeconds?: number };

const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

/**
 * FR-01.1/1.3/1.4: register the Supabase session, link the platform user on first login, enforce one live
 * session, and start the new-device check when the device cookie is unknown or its trust expired.
 * Runs before the caller is authenticated → system context.
 */
export async function registerSession(input: { tenantId: string; accessToken: string; deviceCookie: string; ip: string | null; userAgent: string | null; requestId: string; now: Date }): Promise<SessionState> {
  let claims;
  try {
    claims = await verifyAccessToken(input.accessToken);
  } catch {
    throw errors.unauthenticated("Invalid Supabase token");
  }
  return withSystemContext(input.tenantId, async (tx) => {
    const ctx: SystemContext = { requestId: input.requestId, tenantId: input.tenantId, tx, now: input.now };
    let user = (await tx.select().from(schema.users).where(and(eq(schema.users.tenantId, input.tenantId), eq(schema.users.authUserId, claims.sub))).limit(1))[0];
    if (!user && claims.email) {
      // first login: link by email (seeded/invited users have no auth_user_id yet)
      const byEmail = (await tx.select().from(schema.users).where(and(eq(schema.users.tenantId, input.tenantId), eq(schema.users.email, claims.email.toLowerCase()))).limit(1))[0];
      if (byEmail && !byEmail.authUserId) {
        user = (await tx.update(schema.users).set({ authUserId: claims.sub, status: byEmail.status === "INVITED" ? "ACTIVE" : byEmail.status }).where(eq(schema.users.id, byEmail.id)).returning())[0];
        await audit(ctx, { action: "user.linked", entityType: "user", entityId: user.id, after: { authUserId: claims.sub } });
      }
    }
    if (!user) throw errors.unauthenticated("No platform user for this login");
    if (user.status === "DEACTIVATED") throw errors.unauthenticated("User is deactivated");
    if (user.status === "INVITED") {
      user = (await tx.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, user.id)).returning())[0];
    }

    // one live session per user (FR-01.4): the DB row is the control
    const existing = (await tx.select().from(schema.userSessions).where(eq(schema.userSessions.userId, user.id)).limit(1))[0];
    if (existing) {
      await tx.update(schema.userSessions).set({ sessionId: claims.session_id, device: input.userAgent, ip: input.ip, startedAt: input.now }).where(eq(schema.userSessions.userId, user.id));
    } else {
      await tx.insert(schema.userSessions).values({ userId: user.id, tenantId: input.tenantId, sessionId: claims.session_id, device: input.userAgent, ip: input.ip, startedAt: input.now });
    }
    await tx.update(schema.users).set({ lastLoginAt: input.now }).where(eq(schema.users.id, user.id));
    await audit(ctx, { action: "auth.login", entityType: "user", entityId: user.id, after: { sessionReplaced: Boolean(existing && existing.sessionId !== claims.session_id) } });
    if (existing && existing.sessionId !== claims.session_id && supabaseConfigured() && config().SUPABASE_SERVICE_ROLE_KEY) {
      // courtesy: ask Supabase to end the user's other sessions
      try { await supabaseAdmin().auth.admin.signOut(input.accessToken, "others"); } catch { /* the DB comparison is the control */ }
    }

    // device trust (FR-01.2, FR-01.3)
    const hash = deviceHash(input.deviceCookie);
    const device = (await tx.select().from(schema.trustedDevices).where(and(eq(schema.trustedDevices.userId, user.id), eq(schema.trustedDevices.deviceHash, hash))).limit(1))[0];
    if (device && device.status === "TRUSTED" && device.trustedUntil && new Date(device.trustedUntil) > input.now) {
      await tx.update(schema.trustedDevices).set({ lastSeenAt: input.now }).where(and(eq(schema.trustedDevices.userId, user.id), eq(schema.trustedDevices.deviceHash, hash)));
      return { status: "ACTIVE" };
    }
    if (!(await getSetting(input.tenantId, "auth.device_verification_required", tx))) {
      // tenant opted out of the new-device code: trust this device right away
      const days = Number(await getSetting(input.tenantId, "auth.trusted_device_days", tx));
      const values = { status: "TRUSTED" as const, codeHash: null, codeExpiresAt: null, attempts: 0, lockedUntil: null, trustedUntil: new Date(input.now.getTime() + days * 86400_000), userAgent: input.userAgent, lastSeenAt: input.now };
      if (device) await tx.update(schema.trustedDevices).set(values).where(and(eq(schema.trustedDevices.userId, user.id), eq(schema.trustedDevices.deviceHash, hash)));
      else await tx.insert(schema.trustedDevices).values({ tenantId: input.tenantId, userId: user.id, deviceHash: hash, ...values });
      await audit(ctx, { action: "auth.device_trusted", entityType: "user", entityId: user.id, after: { days, verificationSkipped: true } });
      return { status: "ACTIVE" };
    }
    return sendDeviceCode(ctx, user, hash, input.userAgent, device ?? null);
  });
}

async function sendDeviceCode(ctx: SystemContext, user: typeof schema.users.$inferSelect, hash: string, userAgent: string | null, existing: typeof schema.trustedDevices.$inferSelect | null): Promise<SessionState> {
  const expiryMin = Number(await getSetting(ctx.tenantId, "auth.device_otp_expiry_minutes", ctx.tx));
  const resendAfter = 60;
  if (existing?.lockedUntil && new Date(existing.lockedUntil) > ctx.now) {
    throw errors.rateLimited("Too many wrong codes; try again later", { lockedUntil: existing.lockedUntil });
  }
  if (existing?.lastSeenAt && existing.status === "PENDING" && ctx.now.getTime() - new Date(existing.lastSeenAt).getTime() < resendAfter * 1000) {
    const wait = Math.ceil((resendAfter * 1000 - (ctx.now.getTime() - new Date(existing.lastSeenAt).getTime())) / 1000);
    return { status: "DEVICE_OTP_SENT", otpExpiresAt: existing.codeExpiresAt ? new Date(existing.codeExpiresAt) : undefined, resendAfterSeconds: wait };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(ctx.now.getTime() + expiryMin * 60_000);
  const values = { status: "PENDING" as const, codeHash: hashCode(code), codeExpiresAt: expiresAt, attempts: 0, lockedUntil: null, trustedUntil: null, userAgent, lastSeenAt: ctx.now };
  if (existing) await ctx.tx.update(schema.trustedDevices).set(values).where(and(eq(schema.trustedDevices.userId, user.id), eq(schema.trustedDevices.deviceHash, hash)));
  else await ctx.tx.insert(schema.trustedDevices).values({ tenantId: ctx.tenantId, userId: user.id, deviceHash: hash, ...values });
  const m = await mailer();
  await m.send({ to: user.email, subject: "Your Ecofy Lead Workspace sign-in code", text: `Hello ${user.fullName},\n\nYour verification code for a new device is ${code}. It expires in ${expiryMin} minutes.\n\nIf this was not you, contact your iTarang Admin.` });
  await audit(ctx, { action: "auth.device_code_sent", entityType: "user", entityId: user.id });
  return { status: "DEVICE_OTP_SENT", otpExpiresAt: expiresAt, resendAfterSeconds: resendAfter };
}

export async function verifyDevice(ctx: RequestContext, deviceCookie: string, code: string): Promise<SessionState> {
  const userId = ctx.auth.userId;
  const hash = deviceHash(deviceCookie);
  const d = (await ctx.tx.select().from(schema.trustedDevices).where(and(eq(schema.trustedDevices.userId, userId), eq(schema.trustedDevices.deviceHash, hash))).limit(1))[0];
  if (!d || d.status !== "PENDING" || !d.codeHash) throw errors.validation("No verification pending for this device");
  if (d.lockedUntil && new Date(d.lockedUntil) > ctx.now) throw errors.rateLimited("Too many wrong codes; try again later", { lockedUntil: d.lockedUntil });
  if (!d.codeExpiresAt || new Date(d.codeExpiresAt) < ctx.now) throw errors.validation("Code expired; request a new one");
  const maxAttempts = Number(await getSetting(ctx.auth.tenantId, "auth.device_otp_max_attempts", ctx.tx));
  if (hashCode(code) !== d.codeHash) {
    const attempts = d.attempts + 1;
    const lockout = Number(await getSetting(ctx.auth.tenantId, "auth.device_lockout_minutes", ctx.tx));
    const locked = attempts >= maxAttempts;
    await withDbContext({ tenantId: ctx.auth.tenantId, userId, role: ctx.auth.role }, async (tx) => {
      await tx.update(schema.trustedDevices).set({ attempts: Math.min(attempts, 5), lockedUntil: locked ? new Date(ctx.now.getTime() + lockout * 60_000) : null }).where(and(eq(schema.trustedDevices.userId, userId), eq(schema.trustedDevices.deviceHash, hash)));
      await audit({ ...ctx, tx }, { action: "auth.device_code_failed", entityType: "user", entityId: userId, after: { attempts, locked } });
    });
    if (locked) throw errors.rateLimited(`Locked for ${lockout} minutes after ${maxAttempts} wrong codes`);
    throw errors.validation("Wrong code", { attemptsRemaining: maxAttempts - attempts });
  }
  const days = Number(await getSetting(ctx.auth.tenantId, "auth.trusted_device_days", ctx.tx));
  await ctx.tx.update(schema.trustedDevices).set({ status: "TRUSTED", codeHash: null, codeExpiresAt: null, attempts: 0, lockedUntil: null, trustedUntil: new Date(ctx.now.getTime() + days * 86400_000), lastSeenAt: ctx.now }).where(and(eq(schema.trustedDevices.userId, userId), eq(schema.trustedDevices.deviceHash, hash)));
  await audit(ctx, { action: "auth.device_trusted", entityType: "user", entityId: userId, after: { days } });
  return { status: "ACTIVE" };
}

export async function resendDevice(ctx: RequestContext, deviceCookie: string): Promise<SessionState> {
  const hash = deviceHash(deviceCookie);
  const user = (await ctx.tx.select().from(schema.users).where(eq(schema.users.id, ctx.auth.userId)).limit(1))[0];
  const d = (await ctx.tx.select().from(schema.trustedDevices).where(and(eq(schema.trustedDevices.userId, user.id), eq(schema.trustedDevices.deviceHash, hash))).limit(1))[0] ?? null;
  if (d && d.status === "TRUSTED" && d.trustedUntil && new Date(d.trustedUntil) > ctx.now) return { status: "ACTIVE" };
  const sys: SystemContext = { requestId: ctx.requestId, tenantId: ctx.auth.tenantId, tx: ctx.tx, now: ctx.now };
  return sendDeviceCode(sys, user, hash, ctx.userAgent, d);
}

export async function logout(ctx: RequestContext) {
  await ctx.tx.delete(schema.userSessions).where(eq(schema.userSessions.userId, ctx.auth.userId));
  await audit(ctx, { action: "auth.logout", entityType: "user", entityId: ctx.auth.userId });
}

export function me(ctx: RequestContext) {
  const a = ctx.auth;
  return { id: a.userId, fullName: a.fullName, email: a.email, role: a.role, org: a.org, permissions: PERMISSIONS[a.role] };
}

// ------------------------------------------------------------------ users & seats (FR-01.7 … FR-01.10)

export async function listUsers(ctx: RequestContext, q: { cursor?: string; limit?: number }) {
  const limit = q.limit ?? 50;
  const cur = decodeCursor<{ createdAt: string; id: string }>(q.cursor);
  const conds = [eq(schema.users.tenantId, ctx.auth.tenantId)];
  if (ctx.auth.role === "ECOFY_ADMIN") conds.push(eq(schema.users.orgId, ctx.auth.orgId));
  if (cur) conds.push(sql`(${schema.users.createdAt}, ${schema.users.id}) > (${cur.createdAt}::timestamptz, ${cur.id}::uuid)`);
  const rows = await ctx.tx.select().from(schema.users).where(and(...conds)).orderBy(schema.users.createdAt, schema.users.id).limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const last = pageRows[pageRows.length - 1];
  return { data: pageRows.map(userOut), meta: { nextCursor: rows.length > limit && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null, limit } };
}

export function userOut(u: typeof schema.users.$inferSelect) {
  return { id: u.id, fullName: u.fullName, email: u.email, mobile: u.mobileE164, role: u.role, status: u.status, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt };
}

async function takeSeat(tx: Tx, tenantId: string, role: Role): Promise<boolean> {
  const r = await tx
    .update(schema.seatLimits)
    .set({ seatsUsed: sql`${schema.seatLimits.seatsUsed} + 1` })
    .where(and(eq(schema.seatLimits.tenantId, tenantId), eq(schema.seatLimits.role, role), sql`${schema.seatLimits.seatsUsed} < ${schema.seatLimits.seatLimit}`))
    .returning({ role: schema.seatLimits.role });
  return r.length === 1;
}

async function releaseSeat(tx: Tx, tenantId: string, role: Role) {
  await tx
    .update(schema.seatLimits)
    .set({ seatsUsed: sql`greatest(${schema.seatLimits.seatsUsed} - 1, 0)` })
    .where(and(eq(schema.seatLimits.tenantId, tenantId), eq(schema.seatLimits.role, role)));
}

export async function inviteUser(ctx: RequestContext, input: UserInviteT) {
  const tenantId = ctx.auth.tenantId;
  if (ctx.auth.role === "ECOFY_ADMIN" && input.role !== "ECOFY_USER") throw errors.forbidden("Ecofy Admin can invite Ecofy Users only");
  const org = (await ctx.tx.select().from(schema.orgs).where(and(eq(schema.orgs.tenantId, tenantId), eq(schema.orgs.kind, orgOf(input.role)))).limit(1))[0];
  if (!org) throw errors.internal("Org missing");
  if (!(await takeSeat(ctx.tx, tenantId, input.role))) throw errors.seatLimit(input.role);
  const email = input.email.toLowerCase();
  const user = (await ctx.tx.insert(schema.users).values({ tenantId, orgId: org.id, fullName: input.fullName, email, mobileE164: input.mobile ? `+91${input.mobile}` : null, role: input.role, status: "INVITED", createdBy: ctx.auth.userId }).returning())[0];
  await ctx.tx.insert(schema.seatLedger).values({ tenantId, role: input.role, action: "SEAT_ADDED", userId: user.id, actorId: ctx.auth.userId });
  await audit(ctx, { action: "user.invite", entityType: "user", entityId: user.id, after: { email, role: input.role } });
  const link = await inviteLink(email, input.fullName);
  await emit(ctx, "user.invited", user.id, { email, role: input.role });
  await emit(ctx, "job.email.send", user.id, {
    to: email, subject: "You are invited to Ecofy Lead Workspace",
    text: `Hello ${input.fullName},\n\nYou have been invited as ${input.role.replace("_", " ")}.\n${link ? `Set your password here: ${link}` : "Your administrator will share your login details."}\n\nSign in at ${config().APP_BASE_URL}/login`,
  });
  return userOut(user);
}

/** Supabase invite/recovery link generation; failures inside the transaction roll the seat back. */
async function inviteLink(email: string, fullName: string): Promise<string | null> {
  if (!supabaseConfigured() || !config().SUPABASE_SERVICE_ROLE_KEY) return null;
  const sb = supabaseAdmin();
  const redirectTo = `${config().APP_BASE_URL}/reset-password`;
  const inv = await sb.auth.admin.generateLink({ type: "invite", email, options: { data: { full_name: fullName }, redirectTo } });
  if (!inv.error && inv.data.properties?.action_link) return inv.data.properties.action_link;
  const rec = await sb.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
  if (rec.error) throw errors.internal(`Supabase: ${rec.error.message}`);
  return rec.data.properties?.action_link ?? null;
}

export async function patchUser(ctx: RequestContext, userId: string, input: UserPatchT) {
  const tenantId = ctx.auth.tenantId;
  const u = (await ctx.tx.select().from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.id, userId))).limit(1))[0];
  if (!u) throw errors.notFound("User");
  if (ctx.auth.role === "ECOFY_ADMIN" && u.orgId !== ctx.auth.orgId) throw errors.notFound("User");
  if (u.id === ctx.auth.userId && input.status === "DEACTIVATED") throw errors.validation("You cannot deactivate yourself");
  const set: Partial<typeof schema.users.$inferInsert> = {};
  if (input.fullName) set.fullName = input.fullName;
  if (input.status === "DEACTIVATED" && u.status !== "DEACTIVATED") {
    set.status = "DEACTIVATED";
    set.deactivatedAt = ctx.now;
    await releaseSeat(ctx.tx, tenantId, u.role as Role);
    await ctx.tx.insert(schema.seatLedger).values({ tenantId, role: u.role, action: "SEAT_RELEASED", userId: u.id, actorId: ctx.auth.userId });
    await ctx.tx.delete(schema.userSessions).where(eq(schema.userSessions.userId, u.id));
    await ctx.tx.update(schema.trustedDevices).set({ status: "REVOKED", trustedUntil: null }).where(eq(schema.trustedDevices.userId, u.id));
    // FR-01.9: open cases become unassigned (visible in the admin's unassigned view)
    const open = await ctx.tx.select({ id: schema.cases.id }).from(schema.cases).where(and(eq(schema.cases.assignedUserId, u.id), sql`${schema.cases.stage} <> 'CLOSED'`));
    for (const c of open) {
      await ctx.tx.update(schema.caseAssignments).set({ endedAt: ctx.now }).where(and(eq(schema.caseAssignments.caseId, c.id), isNull(schema.caseAssignments.endedAt)));
      await ctx.tx.update(schema.cases).set({ assignedUserId: null, version: sql`${schema.cases.version} + 1`, updatedAt: ctx.now }).where(eq(schema.cases.id, c.id));
      await audit(ctx, { action: "case.unassign", entityType: "case", entityId: c.id, caseId: c.id, reason: "user deactivated" });
    }
    await emit(ctx, "user.deactivated", u.id, { unassignedCases: open.length });
  } else if (input.status === "ACTIVE" && u.status === "DEACTIVATED") {
    if (!(await takeSeat(ctx.tx, tenantId, u.role as Role))) throw errors.seatLimit(u.role);
    set.status = "ACTIVE";
    set.deactivatedAt = null;
    await ctx.tx.insert(schema.seatLedger).values({ tenantId, role: u.role, action: "SEAT_ADDED", userId: u.id, actorId: ctx.auth.userId });
  }
  const updated = (await ctx.tx.update(schema.users).set(set).where(eq(schema.users.id, u.id)).returning())[0];
  await audit(ctx, { action: "user.patch", entityType: "user", entityId: u.id, before: { fullName: u.fullName, status: u.status }, after: { fullName: updated.fullName, status: updated.status }, reason: input.reason });
  return userOut(updated);
}

export async function resetPassword(ctx: RequestContext, userId: string) {
  const u = (await ctx.tx.select().from(schema.users).where(and(eq(schema.users.tenantId, ctx.auth.tenantId), eq(schema.users.id, userId))).limit(1))[0];
  if (!u || (ctx.auth.role === "ECOFY_ADMIN" && u.orgId !== ctx.auth.orgId)) throw errors.notFound("User");
  let link: string | null = null;
  if (supabaseConfigured() && config().SUPABASE_SERVICE_ROLE_KEY) {
    const r = await supabaseAdmin().auth.admin.generateLink({ type: "recovery", email: u.email, options: { redirectTo: `${config().APP_BASE_URL}/reset-password` } });
    if (r.error) throw errors.internal(`Supabase: ${r.error.message}`);
    link = r.data.properties?.action_link ?? null;
  }
  await audit(ctx, { action: "auth.password_reset_sent", entityType: "user", entityId: u.id });
  await emit(ctx, "job.email.send", u.id, { to: u.email, subject: "Reset your Ecofy Lead Workspace password", text: `Hello ${u.fullName},\n\n${link ? `Reset your password here: ${link}` : "Ask your administrator to reset your password."}` });
}

export async function revokeDevices(ctx: RequestContext, userId: string, reason: string) {
  const u = (await ctx.tx.select().from(schema.users).where(and(eq(schema.users.tenantId, ctx.auth.tenantId), eq(schema.users.id, userId))).limit(1))[0];
  if (!u) throw errors.notFound("User");
  await ctx.tx.update(schema.trustedDevices).set({ status: "REVOKED", trustedUntil: null, codeHash: null }).where(eq(schema.trustedDevices.userId, u.id));
  await audit(ctx, { action: "auth.devices_revoked", entityType: "user", entityId: u.id, reason });
}

export async function listSeats(ctx: RequestContext) {
  const rows = await ctx.tx.select().from(schema.seatLimits).where(eq(schema.seatLimits.tenantId, ctx.auth.tenantId));
  return rows.map((r) => ({ role: r.role, seatLimit: r.seatLimit, seatsUsed: r.seatsUsed }));
}

export async function patchSeat(ctx: RequestContext, role: string, seatLimit: number, reason: string) {
  if (!isRole(role)) throw errors.notFound("Role");
  const cur = (await ctx.tx.select().from(schema.seatLimits).where(and(eq(schema.seatLimits.tenantId, ctx.auth.tenantId), eq(schema.seatLimits.role, role))).limit(1))[0];
  if (!cur) throw errors.notFound("Role");
  if (seatLimit < cur.seatsUsed) throw errors.validation(`${cur.seatsUsed} seats are in use; deactivate users first`);
  await ctx.tx.update(schema.seatLimits).set({ seatLimit }).where(and(eq(schema.seatLimits.tenantId, ctx.auth.tenantId), eq(schema.seatLimits.role, role)));
  await ctx.tx.insert(schema.seatLedger).values({ tenantId: ctx.auth.tenantId, role, action: "LIMIT_CHANGED", oldLimit: cur.seatLimit, newLimit: seatLimit, actorId: ctx.auth.userId });
  await audit(ctx, { action: "seat.limit_changed", entityType: "seat_limit", entityId: role, before: { seatLimit: cur.seatLimit }, after: { seatLimit }, reason });
  await emit(ctx, "seat.limit_changed", ctx.auth.tenantId, { role, oldLimit: cur.seatLimit, newLimit: seatLimit });
}

/** Users the admin may assign to (active, by role). */
export async function activeUsersByRole(tx: Tx, tenantId: string, role: Role) {
  return tx.select({ id: schema.users.id, fullName: schema.users.fullName, email: schema.users.email }).from(schema.users).where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.role, role), eq(schema.users.status, "ACTIVE"))).orderBy(schema.users.fullName);
}

// keep imports referenced for future expansions
void gt; void desc; void lt;
