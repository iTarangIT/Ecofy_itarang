import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListBucketsCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { config } from "@/core/config";
import type { Storage, PresignedUrl } from "./types";

/** Private bucket, SSE, presigned URLs (5 minutes). Keys are prefixed with S3_PREFIX (ecofy/prod/ or ecofy/sandbox/). */
export class S3Storage implements Storage {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor() {
    const c = config();
    if (!c.S3_BUCKET) throw new Error("S3_BUCKET is required for STORAGE_DRIVER=s3");
    this.client = new S3Client({ region: c.AWS_REGION });
    this.bucket = c.S3_BUCKET;
    this.prefix = c.S3_PREFIX.replace(/^\/+/, "");
  }

  private k(key: string) {
    return `${this.prefix}${key}`;
  }

  async presignPut(key: string, opts: { contentType: string; sizeBytes: number; expiresInSeconds?: number }): Promise<PresignedUrl> {
    const expiresIn = opts.expiresInSeconds ?? 300;
    const cmd = new PutObjectCommand({ Bucket: this.bucket, Key: this.k(key), ContentType: opts.contentType, ContentLength: opts.sizeBytes, ServerSideEncryption: "AES256" });
    const url = await getSignedUrl(this.client, cmd, { expiresIn });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000), headers: { "Content-Type": opts.contentType } };
  }

  async presignGet(key: string, opts: { fileName?: string; expiresInSeconds?: number } = {}): Promise<PresignedUrl> {
    const expiresIn = opts.expiresInSeconds ?? 300;
    const cmd = new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key), ...(opts.fileName ? { ResponseContentDisposition: `attachment; filename="${opts.fileName.replace(/"/g, "")}"` } : {}) });
    const url = await getSignedUrl(this.client, cmd, { expiresIn });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000) };
  }

  async head(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
      return { sizeBytes: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
    } catch {
      return null;
    }
  }

  async getObject(key: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
    const bytes = await r.Body?.transformToByteArray();
    return Buffer.from(bytes ?? new Uint8Array());
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.k(key), Body: body, ContentType: contentType, ServerSideEncryption: "AES256" }));
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.k(key) }));
  }

  async sha256(key: string): Promise<string> {
    return createHash("sha256").update(await this.getObject(key)).digest("hex");
  }

  async ping(): Promise<boolean> {
    try { await this.client.send(new ListBucketsCommand({})); return true; } catch { return false; }
  }
}
