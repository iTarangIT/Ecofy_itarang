import { NextResponse } from "next/server";
import { AppError, fromPgError, isAppError } from "./errors";
import { toApi, type PageMeta } from "./serialize";
import { logger } from "./logger";

export type Ok = { data: unknown; meta?: PageMeta | Record<string, unknown>; status?: number; headers?: Record<string, string> };
export type Empty = { status?: number; headers?: Record<string, string>; empty: true };
export type Raw = { raw: Response };
export type HandlerResult = Ok | Empty | Raw;

export function ok(data: unknown, extra: Omit<Ok, "data"> = {}): Ok {
  return { data, ...extra };
}
export function created(data: unknown, extra: Omit<Ok, "data" | "status"> = {}): Ok {
  return { data, status: 201, ...extra };
}
export function accepted(data: unknown): Ok {
  return { data, status: 202 };
}
export function empty(status = 200, headers?: Record<string, string>): Empty {
  return { empty: true, status, headers };
}
export function raw(res: Response): Raw {
  return { raw: res };
}
export function page(data: unknown[], meta: PageMeta): Ok {
  return { data, meta };
}

export function toResponse(result: HandlerResult, requestId: string): Response {
  if ("raw" in result) {
    result.raw.headers.set("X-Request-Id", requestId);
    return result.raw;
  }
  const headers = { "X-Request-Id": requestId, ...(result.headers ?? {}) };
  if ("empty" in result) return new NextResponse(null, { status: result.status ?? 200, headers });
  const body: Record<string, unknown> = { data: toApi(result.data) };
  if (result.meta) body.meta = toApi(result.meta);
  return NextResponse.json(body, { status: result.status ?? 200, headers });
}

export function toErrorResponse(e: unknown, requestId: string): Response {
  let err: AppError;
  if (isAppError(e)) err = e;
  else {
    const pg = fromPgError(e);
    if (pg) err = pg;
    else {
      logger.error({ requestId, err: e }, "unhandled error");
      err = new AppError("INTERNAL", "Unexpected error", { cause: e });
    }
  }
  if (err.status >= 500) logger.error({ requestId, code: err.code, err: err.cause ?? err }, err.message);
  else logger.info({ requestId, code: err.code, gate: err.gate }, err.message);
  const body = {
    error: {
      code: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
      ...(err.gate ? { gate: err.gate } : {}),
      requestId,
    },
  };
  return NextResponse.json(body, { status: err.status, headers: { "X-Request-Id": requestId } });
}
