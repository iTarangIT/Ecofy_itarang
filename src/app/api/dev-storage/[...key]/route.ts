import { NextResponse, type NextRequest } from "next/server";
import { config } from "@/core/config";
import { LocalFsStorage } from "@/adapters/storage/localFs";

/** Local presigned-URL emulation for STORAGE_DRIVER=local: signed PUT/GET on the filesystem. Never enabled with s3. */
function guard() {
  if (config().STORAGE_DRIVER !== "local") return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
  return null;
}

async function keyOf(extra: { params: Promise<{ key: string[] }> }) {
  const { key } = await extra.params;
  return key.map(decodeURIComponent).join("/");
}

export async function PUT(req: NextRequest, extra: { params: Promise<{ key: string[] }> }) {
  const g = guard(); if (g) return g;
  const key = await keyOf(extra);
  const st = new LocalFsStorage();
  const q = req.nextUrl.searchParams;
  const ct = q.get("ct") ?? req.headers.get("content-type") ?? "application/octet-stream";
  if (q.get("op") !== "put" || !st.verify(key, "put", Number(q.get("exp")), q.get("sig") ?? "", ct)) return new NextResponse("forbidden", { status: 403 });
  const body = Buffer.from(await req.arrayBuffer());
  await st.putObject(key, body, ct);
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: NextRequest, extra: { params: Promise<{ key: string[] }> }) {
  const g = guard(); if (g) return g;
  const key = await keyOf(extra);
  const st = new LocalFsStorage();
  const q = req.nextUrl.searchParams;
  const fn = q.get("fn") ?? "";
  if (q.get("op") !== "get" || !st.verify(key, "get", Number(q.get("exp")), q.get("sig") ?? "", fn)) return new NextResponse("forbidden", { status: 403 });
  const head = await st.head(key);
  if (!head) return new NextResponse("not found", { status: 404 });
  const buf = await st.getObject(key);
  const headers: Record<string, string> = { "Content-Type": head.contentType ?? "application/octet-stream" };
  if (fn) headers["Content-Disposition"] = 'attachment; filename="' + fn.replace(/"/g, "") + '"';
  return new NextResponse(new Uint8Array(buf), { status: 200, headers });
}
