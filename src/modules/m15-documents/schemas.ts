import { z } from "zod";

export const MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "audio/mpeg", "audio/mp4", "audio/wav"] as const;

export const FileUploadStart = z.object({
  typeCode: z.string().min(1),
  fileName: z.string().min(1).max(200),
  mimeType: z.enum(MIME_TYPES),
  sizeBytes: z.number().int().min(1).max(26_214_400),
});
export const DocumentCommit = z.object({ documentId: z.string().uuid(), sha256: z.string().regex(/^[a-f0-9]{64}$/), recordingConsent: z.boolean().optional() });
