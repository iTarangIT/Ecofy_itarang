/** Object storage port (M15). Files never pass through the app server: presigned PUT/GET, 5-minute URLs. */
export type PresignedUrl = { url: string; expiresAt: Date; headers?: Record<string, string> };

export interface Storage {
  readonly driver: "local" | "s3";
  presignPut(key: string, opts: { contentType: string; sizeBytes: number; expiresInSeconds?: number }): Promise<PresignedUrl>;
  presignGet(key: string, opts: { fileName?: string; expiresInSeconds?: number }): Promise<PresignedUrl>;
  head(key: string): Promise<{ sizeBytes: number; contentType: string | null } | null>;
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  /** sha256 of the stored object (hex). */
  sha256(key: string): Promise<string>;
  /** Liveness for /health */
  ping(): Promise<boolean>;
}
