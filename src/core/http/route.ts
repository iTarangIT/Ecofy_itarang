import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";
import { config } from "@/core/config";
import { withDbContext } from "@/core/db/tx";
import { authenticate, type Authenticated } from "@/core/auth/session";
import { authenticateService, ACTOR_NAME_HEADER } from "@/core/auth/service";
import { SIGNATURE_HEADER } from "@/core/auth/hmac";
import { readCookies, sessionCookies } from "@/core/auth/cookies";
import { resolveTenant, normaliseHost } from "@/core/auth/tenant";
import { type Role } from "@/core/auth/rbac";
import { errors } from "./errors";
import { toResponse, toErrorResponse, type HandlerResult, type Ok } from "./envelope";
import { withIdempotency } from "./idempotency";
import { requestIdFrom, clientIp } from "./requestId";
import { logger } from "./logger";
import type { RequestContext } from "./context";

export type RouteOptions<B, Q> = {
  /** OpenAPI x-roles. `"public"` = no auth (health, webhooks). */
  roles: readonly Role[] | "public";
  /** `"session-only"`: authenticated but the device may still be untrusted (the /auth/device routes). */
  device?: "trusted" | "session-only";
  /** Require `If-Match: <case version>`; parsed integer given to the handler. */
  ifMatch?: boolean;
  /** Require `Idempotency-Key`; replay semantics per BRD §6. */
  idempotent?: boolean;
  body?: ZodType<B>;
  query?: ZodType<Q>;
  /** Skip the transaction/DB context (public routes without DB). */
  noTx?: boolean;
};

export type RouteArgs<B = unknown, Q = unknown> = {
  req: NextRequest;
  params: Record<string, string>;
  body: B;
  query: Q;
  ctx: RequestContext;
  ifMatch: number | null;
  /** Set-Cookie values the handler wants added (auth routes). */
  cookies: Array<Parameters<NextResponse["cookies"]["set"]>[0] & { name: string; value: string }>;
};

type NextHandler = (req: NextRequest, extra: { params: Promise<Record<string, string>> }) => Promise<Response>;

/**
 * The request pipeline (BRD §6, plan §Key mechanisms 1). Every /api/v1 route is `route({...}, handler)`.
 * One transaction per request; the handler's writes, audit rows and outbox rows commit together.
 */
export function route<B = unknown, Q = unknown>(opts: RouteOptions<B, Q>, handler: (args: RouteArgs<B, Q>) => Promise<HandlerResult>): NextHandler {
  return async (req, extra) => {
    const requestId = requestIdFrom(req.headers);
    const startedAt = Date.now();
    const log = logger.child({ requestId, method: req.method, path: req.nextUrl.pathname });
    try {
      const params = (await extra?.params) ?? {};
      const query = parseQuery<Q>(opts.query, req);
      const rawBody = await readRawBody(req);
      const body = req.method === "GET" || req.method === "HEAD" ? (undefined as unknown as B) : parseBody<B>(opts.body, rawBody);
      const ifMatch = opts.ifMatch ? parseIfMatch(req) : null;
      const idemKey = opts.idempotent ? parseIdempotencyKey(req) : null;

      if (opts.roles === "public") {
        const res = await handler({ req, params, body, query, ctx: undefined as unknown as RequestContext, ifMatch, cookies: [] });
        return finish(res, requestId, [], log, startedAt);
      }

      const host = normaliseHost(req.headers.get("host"));
      const tenantId = await resolveTenant(host);
      if (!tenantId) throw errors.notFound("Tenant");

      const now = new Date();
      // iTarang CRM service call (signed, acts as an iTarang user) or a browser session (cookies)
      const service = req.headers.has(SIGNATURE_HEADER);
      // sign-in, device and logout routes belong to a person's browser session, never to a service
      if (service && req.nextUrl.pathname.startsWith("/api/v1/auth/")) throw errors.forbidden("Service calls cannot use /auth routes");
      const authd: Authenticated = service
        ? { auth: await authenticateService(tenantId, { method: req.method, pathWithQuery: req.nextUrl.pathname + req.nextUrl.search, headers: req.headers }, rawBody, now), deviceTrusted: true }
        : await authenticate(tenantId, readCookies(req), now);
      if (opts.device !== "session-only" && !authd.deviceTrusted) throw errors.deviceVerification();
      if (!opts.roles.includes(authd.auth.role)) throw errors.forbidden();

      const setCookies: RouteArgs["cookies"] = [];
      if (authd.rotated) setCookies.push(...sessionCookies(authd.rotated.accessToken, authd.rotated.refreshToken));

      const result = await withDbContext({ tenantId, userId: authd.auth.userId, role: authd.auth.role }, async (tx) => {
        const userAgent = service ? `itarang-crm${req.headers.get(ACTOR_NAME_HEADER) ? ` (${req.headers.get(ACTOR_NAME_HEADER)!.slice(0, 120)})` : ""}` : req.headers.get("user-agent");
        const ctx: RequestContext = { requestId, ip: clientIp(req.headers), userAgent, auth: authd.auth, tx, now };
        const args: RouteArgs<B, Q> = { req, params, body, query, ctx, ifMatch, cookies: setCookies };
        if (idemKey) {
          return withIdempotency(ctx, idemKey, `${req.method} ${req.nextUrl.pathname}`, body, async () => {
            const r = await handler(args);
            if (!("data" in r)) throw new Error("idempotent routes must return a data envelope");
            return r as Ok;
          });
        }
        return handler(args);
      });
      return finish(result, requestId, setCookies, log, startedAt);
    } catch (e) {
      const res = toErrorResponse(e, requestId);
      log.info({ status: res.status, ms: Date.now() - startedAt }, "request failed");
      return res;
    }
  };
}

type Log = { info: (obj: object, msg: string) => void };

function finish(result: HandlerResult, requestId: string, cookies: RouteArgs["cookies"], log: Log, startedAt: number) {
  const res = toResponse(result, requestId);
  if (cookies.length) {
    const nres = res instanceof NextResponse ? res : new NextResponse(res.body, res);
    for (const c of cookies) nres.cookies.set(c);
    log.info({ status: nres.status, ms: Date.now() - startedAt }, "request");
    return nres;
  }
  log.info({ status: res.status, ms: Date.now() - startedAt }, "request");
  return res;
}

function parseQuery<Q>(schema: ZodType<Q> | undefined, req: NextRequest): Q {
  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (raw[k] = v));
  if (!schema) return raw as unknown as Q;
  const r = schema.safeParse(raw);
  if (!r.success) throw errors.validation("Invalid query", { issues: r.error.issues });
  return r.data;
}

/** The JSON body as sent (also what a service signature covers); "" for GET/HEAD or non-JSON bodies. */
async function readRawBody(req: NextRequest): Promise<string> {
  if (req.method === "GET" || req.method === "HEAD") return "";
  return (req.headers.get("content-type") ?? "").includes("application/json") ? req.text() : "";
}

function parseBody<B>(schema: ZodType<B> | undefined, text: string): B {
  let raw: unknown = undefined;
  if (text.trim()) {
    try { raw = JSON.parse(text); } catch { throw errors.validation("Body is not valid JSON"); }
  }
  if (!schema) return raw as B;
  const r = schema.safeParse(raw ?? {});
  if (!r.success) throw errors.validation("Request body failed validation", { issues: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
  return r.data;
}

function parseIfMatch(req: NextRequest): number {
  const h = req.headers.get("if-match");
  if (!h) throw errors.validation("If-Match header (case version) is required");
  const n = Number(h.replace(/"/g, "").trim());
  if (!Number.isInteger(n) || n < 1) throw errors.validation("If-Match must be the integer case version");
  return n;
}

function parseIdempotencyKey(req: NextRequest): string {
  const k = req.headers.get("idempotency-key");
  if (!k || k.length < 8 || k.length > 100) throw errors.validation("Idempotency-Key header (8–100 chars) is required");
  return k;
}

/** Convenience for routes that are public but still want config. */
export const appConfig = config;
