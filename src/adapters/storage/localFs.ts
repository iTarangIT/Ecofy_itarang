import fs from "node:fs/promises";
import path from "node:path";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "@/core/config";
import type { Storage, PresignedUrl } from "./types";

/**
 * Local filesystem driver for development: objects live under LOCAL_STORAGE_DIR and
 * "presigned" URLs are HMAC-signed links to /api/dev-storage/<key>?op=put|get&exp=&sig=.
 */
export class LocalFsStorage implements Storage {
  readonly driver = "local" as const;
  private readonly root: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor() {
    const c = config();
    this.root = path.resolve(process.cwd(), c.LOCAL_STORAGE_DIR);
    this.secret = c.LOCAL_SIGNING_SECRET;
    this.baseUrl = c.APP_BASE_URL.replace(/\/$/, "");
  }

  private abs(key: string) {
    const safe = key.replace(/\\/g, "/").replace(/\.\.+/g, ".").replace(/^\/+/, "");
    return path.join(this.root, safe);
  }

  sign(key: string, op: "put" | "get", exp: number, extra = ""): string {
    return createHmac("sha256", this.secret).update(`${op}\n${key}\n${exp}\n${extra}`).digest("hex");
  }

  verify(key: string, op: "put" | "get", exp: number, sig: string, extra = ""): boolean {
    if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
    const expected = this.sign(key, op, exp, extra);
    if (expected.length !== sig.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  }

  private url(key: string, op: "put" | "get", exp: number, extra: Record<string, string>): string {
    const q = new URLSearchParams({ op, exp: String(exp), sig: this.sign(key, op, exp, extra.ct ?? extra.fn ?? ""), ...extra });
    return `${this.baseUrl}/api/dev-storage/${key.split("/").map(encodeURIComponent).join("/")}?${q.toString()}`;
  }

  async presignPut(key: string, opts: { contentType: string; sizeBytes: number; expiresInSeconds?: number }): Promise<PresignedUrl> {
    const exp = Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? 300);
    return { url: this.url(key, "put", exp, { ct: opts.contentType }), expiresAt: new Date(exp * 1000), headers: { "Content-Type": opts.contentType } };
  }

  async presignGet(key: string, opts: { fileName?: string; expiresInSeconds?: number } = {}): Promise<PresignedUrl> {
    const exp = Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? 300);
    return { url: this.url(key, "get", exp, opts.fileName ? { fn: opts.fileName } : {}), expiresAt: new Date(exp * 1000) };
  }

  async head(key: string) {
    try {
      const st = await fs.stat(this.abs(key));
      let contentType: string | null = null;
      try { contentType = (await fs.readFile(this.abs(key) + ".meta", "utf8")).trim() || null; } catch { /* no meta */ }
      return { sizeBytes: st.size, contentType };
    } catch {
      return null;
    }
  }

  async getObject(key: string): Promise<Buffer> {
    return fs.readFile(this.abs(key));
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const p = this.abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body);
    await fs.writeFile(p + ".meta", contentType);
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.abs(key), { force: true });
    await fs.rm(this.abs(key) + ".meta", { force: true });
  }

  async sha256(key: string): Promise<string> {
    const buf = await this.getObject(key);
    return createHash("sha256").update(buf).digest("hex");
  }

  async ping(): Promise<boolean> {
    try { await fs.mkdir(this.root, { recursive: true }); return true; } catch { return false; }
  }
}
