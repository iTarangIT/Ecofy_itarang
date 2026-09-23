/**
 * Calls the Next.js route handlers directly (no HTTP server) with the cookies of a test user.
 * Sessions: a stub JWT (AUTH_JWT_STUB_SECRET) + user_sessions row + a TRUSTED device row, written as owner.
 */
import { NextRequest } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import { signStubToken } from "@/core/auth/jwt";
import { owner, TEST_HOST, type TestTenant, type TestRole } from "./testDb";
import { clearTenantCache } from "@/core/auth/tenant";
import { clearSettingsCache } from "@/core/settings/settingsCache";

type Handler = (req: NextRequest, extra: { params: Promise<Record<string, string>> }) => Promise<Response>;
type RouteModule = Record<string, Handler>;

const routeModules: Array<{ pattern: RegExp; keys: string[]; load: () => Promise<RouteModule> }> = [];

/** Register the API surface once: pattern like "/cases/:caseId/assign" → module loader. */
export function registerRoute(pattern: string, load: () => Promise<RouteModule>) {
  const keys: string[] = [];
  const re = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/:([a-zA-Z]+)/g, (_, k: string) => { keys.push(k); return "([^/]+)"; }) + "$");
  routeModules.push({ pattern: re, keys, load });
}

export type ApiResult<T = any> = { status: number; body: { data?: T; meta?: any; error?: { code: string; message: string; gate?: string; details?: any } }; headers: Headers; raw?: string };

export class ApiClient {
  private cookies: Record<string, string> = {};
  constructor(private readonly tenant: TestTenant, readonly role: TestRole) {}

  async login() {
    const u = this.tenant.users[this.role];
    const sessionId = randomBytes(8).toString("hex");
    const token = await signStubToken({ sub: u.authUserId, email: u.email, session_id: sessionId });
    const device = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(device).digest("hex");
    const sql = owner();
    await sql`insert into user_sessions(user_id, tenant_id, session_id) values (${u.id}, ${this.tenant.tenantId}, ${sessionId}) on conflict (user_id) do update set session_id = excluded.session_id`;
    await sql`insert into trusted_devices(tenant_id, user_id, device_hash, status, trusted_until) values (${this.tenant.tenantId}, ${u.id}, ${hash}, 'TRUSTED', now() + interval '30 days') on conflict (user_id, device_hash) do update set status = 'TRUSTED', trusted_until = now() + interval '30 days'`;
    this.cookies = { "sb-access-token": token, "sb-refresh-token": "test-refresh", ecofy_device: device };
    clearTenantCache();
    clearSettingsCache();
    return this;
  }

  async call<T = any>(method: string, path: string, opts: { body?: unknown; ifMatch?: number; idempotencyKey?: string; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
    const [pathname, search] = path.split("?");
    const match = routeModules.map((r) => ({ r, m: r.pattern.exec(pathname) })).find((x) => x.m);
    if (!match?.m) throw new Error(`no test route registered for ${method} ${pathname}`);
    const mod = await match.r.load();
    const handler = mod[method.toUpperCase()];
    if (!handler) throw new Error(`route ${pathname} has no ${method}`);
    const params: Record<string, string> = {};
    match.r.keys.forEach((k, i) => (params[k] = decodeURIComponent(match.m![i + 1])));
    const headers: Record<string, string> = { host: TEST_HOST, cookie: Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join("; "), ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (opts.ifMatch !== undefined) headers["if-match"] = String(opts.ifMatch);
    if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
    const req = new NextRequest(`http://${TEST_HOST}/api/v1${pathname}${search ? "?" + search : ""}`, { method: method.toUpperCase(), headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const res = await handler(req, { params: Promise.resolve(params) });
    const text = await res.text();
    let body: ApiResult["body"] = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    return { status: res.status, body, headers: res.headers, raw: text };
  }

  get<T = any>(path: string, opts?: Parameters<ApiClient["call"]>[2]) { return this.call<T>("GET", path, opts); }
  post<T = any>(path: string, body?: unknown, opts: Parameters<ApiClient["call"]>[2] = {}) { return this.call<T>("POST", path, { ...opts, body }); }
  patch<T = any>(path: string, body?: unknown, opts: Parameters<ApiClient["call"]>[2] = {}) { return this.call<T>("PATCH", path, { ...opts, body }); }
  put<T = any>(path: string, body?: unknown, opts: Parameters<ApiClient["call"]>[2] = {}) { return this.call<T>("PUT", path, { ...opts, body }); }
  delete<T = any>(path: string, body?: unknown, opts: Parameters<ApiClient["call"]>[2] = {}) { return this.call<T>("DELETE", path, { ...opts, body }); }
}

let counter = 0;
export function idem() {
  return `test-${Date.now()}-${++counter}`;
}

/** Expect helper: throws with the API error message for readable failures. */
export function expectOk<T>(r: ApiResult<T>, status = 200): T {
  if (r.status !== status) throw new Error(`expected ${status}, got ${r.status}: ${JSON.stringify(r.body.error ?? r.body).slice(0, 400)}`);
  return r.body.data as T;
}
