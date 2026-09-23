"use client";

/** Browser client for /api/v1: envelope-aware, sends If-Match / Idempotency-Key, surfaces API errors. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown, readonly gate?: string, readonly requestId?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export type Envelope<T> = { data: T; meta?: Record<string, unknown> & { nextCursor?: string | null; unread?: number } };

type Opts = { body?: unknown; ifMatch?: number; idempotent?: boolean; headers?: Record<string, string>; raw?: boolean };

export async function api<T = unknown>(method: string, path: string, opts: Opts = {}): Promise<Envelope<T>> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.ifMatch !== undefined) headers["If-Match"] = String(opts.ifMatch);
  if (opts.idempotent) headers["Idempotency-Key"] = `ui-${crypto.randomUUID()}`;
  const res = await fetch(`/api/v1${path}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: "same-origin" });
  if (res.status === 401) {
    const j = await res.json().catch(() => ({}));
    const code = j?.error?.code;
    if (code === "DEVICE_VERIFICATION_REQUIRED") { window.location.href = "/login?step=device"; }
    else if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) { window.location.href = `/login?reason=${code ?? "UNAUTHENTICATED"}`; }
    throw new ApiError(401, code ?? "UNAUTHENTICATED", j?.error?.message ?? "Sign in required", j?.error?.details, j?.error?.gate, j?.error?.requestId);
  }
  const text = await res.text();
  let json: { data?: T; meta?: Envelope<T>["meta"]; error?: { code: string; message: string; details?: unknown; gate?: string; requestId?: string } } = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* no body */ }
  if (!res.ok) {
    const e = json.error;
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? res.statusText, e?.details, e?.gate, e?.requestId);
  }
  return { data: json.data as T, meta: json.meta };
}

export const get = <T = unknown>(path: string) => api<T>("GET", path);
export const post = <T = unknown>(path: string, body?: unknown, opts: Omit<Opts, "body"> = {}) => api<T>("POST", path, { ...opts, body });
export const patch = <T = unknown>(path: string, body?: unknown, opts: Omit<Opts, "body"> = {}) => api<T>("PATCH", path, { ...opts, body });
export const put = <T = unknown>(path: string, body?: unknown, opts: Omit<Opts, "body"> = {}) => api<T>("PUT", path, { ...opts, body });
export const del = <T = unknown>(path: string, body?: unknown, opts: Omit<Opts, "body"> = {}) => api<T>("DELETE", path, { ...opts, body });

/** Presigned upload: POST upload-url → PUT bytes → POST commit with sha256. */
export async function uploadDocument(caseId: string, file: File, typeCode: string, opts: { quote?: boolean; recordingConsent?: boolean } = {}) {
  const start = await post<{ id: string; uploadUrl: string; headers?: Record<string, string> }>(`/cases/${caseId}/${opts.quote ? "quotes" : "documents"}/upload-url`, { typeCode, fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size });
  const put = await fetch(start.data.uploadUrl, { method: "PUT", body: file, headers: start.data.headers ?? { "Content-Type": file.type } });
  if (!put.ok) throw new Error(`Upload failed (${put.status})`);
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const commit = await post<{ id: string }>(`/cases/${caseId}/documents`, { documentId: start.data.id, sha256, ...(opts.recordingConsent !== undefined ? { recordingConsent: opts.recordingConsent } : {}) });
  return commit.data;
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.gate ? `${e.message} (gate: ${e.gate})` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
