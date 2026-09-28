import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, HeadBucketCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { config } from "@/core/config";
import type { Storage, PresignedUrl } from "./types";

/**
 * Private bucket, SSE-S3, presigned URLs (5 minutes). Keys are prefixed with S3_PREFIX (ecofy/prod/ or ecofy/staging/).
 * Credentials come from the SDK default chain: AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY on the VPS, an instance
 * role on EC2. The bucket needs a CORS rule for the browser PUT/GET (deploy/aws/s3-cors.json) and the IAM identity
 * needs deploy/aws/s3-iam-policy.json.
 */
export class S3Storage implements Storage {
  readonly driver = "s3" as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly prefix: string;

  constructor() {
    const c = config();
    if (!c.S3_BUCKET) throw new Error("S3_BUCKET is required for STORAGE_DRIVER=s3");
    // WHEN_REQUIRED: the default (WHEN_SUPPORTED) stamps x-amz-checksum-crc32 of an *empty* body into presigned PUT
    // URLs, and S3 then rejects the browser upload with BadDigest. Server-side putObject is unaffected.
    this.client = new S3Client({ region: c.AWS_REGION, requestChecksumCalculation: "WHEN_REQUIRED" });
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
    // The presigner keeps x-amz-server-side-encryption as a *signed header* (it is never hoisted into the query
    // string), so the browser must send it with the PUT or S3 answers 403 SignatureDoesNotMatch.
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000), headers: { "Content-Type": opts.contentType, "x-amz-server-side-encryption": "AES256" } };
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

  /** HeadBucket on the configured bucket: works with a bucket-scoped IAM policy (ListAllMyBuckets would not). */
  async ping(): Promise<boolean> {
    try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); return true; } catch { return false; }
  }
}
