import { and, eq, asc, isNull } from "drizzle-orm";
import type { z } from "zod";
import { schema } from "@/core/db/client";
import { errors } from "@/core/http/errors";
import { audit } from "@/core/audit/audit";
import { emit } from "@/core/events/outbox";
import { getSetting } from "@/core/settings/settingsCache";
import { storage } from "@/adapters";
import { istDate, addDays } from "@/core/calendar/dates";
import type { RequestContext } from "@/core/http/context";
import { requireCase } from "@/modules/m04-qualify/service";
import { assertListCode } from "@/modules/m02-settings/service";
import type { FileUploadStart, DocumentCommit } from "./schemas";

/**
 * M15: documents live in object storage; the row is written at upload-url time (pending) and
 * committed with its checksum after the browser PUT. Uncommitted rows (no sha256 match) are invisible.
 * The pending state is encoded as sha256 = 64 zeros (never a real digest).
 */
const PENDING = "0".repeat(64);

export function documentOut(d: typeof schema.documents.$inferSelect) {
  return { id: d.id, caseId: d.caseId, typeCode: d.typeCode, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, sha256: d.sha256, recordingConsent: d.recordingConsent, retentionUntil: d.retentionUntil, uploadedBy: d.uploadedBy, uploadedAt: d.uploadedAt, deletedAt: d.deletedAt };
}

export async function listDocuments(ctx: RequestContext, caseId: string) {
  const c = await requireCase(ctx, caseId);
  const rows = await ctx.tx.select().from(schema.documents).where(and(eq(schema.documents.caseId, c.id), isNull(schema.documents.deletedAt))).orderBy(asc(schema.documents.uploadedAt));
  return rows.filter((r) => r.sha256 !== PENDING).map(documentOut);
}

async function assertEcofyMayUpload(ctx: RequestContext, stage: string) {
  const role = ctx.auth.role;
  if ((role === "ECOFY_ADMIN" || role === "ECOFY_USER") && stage !== "S0") {
    const allowed = await getSetting(ctx.auth.tenantId, "permissions.ecofy_docs_after_handoff", ctx.tx);
    if (!allowed) throw errors.forbidden("After handoff Ecofy users cannot add documents (setting permissions.ecofy_docs_after_handoff)");
  }
}

export async function startUpload(ctx: RequestContext, caseId: string, input: z.infer<typeof FileUploadStart>, opts: { keyPrefix?: string } = {}) {
  const c = await requireCase(ctx, caseId);
  await assertEcofyMayUpload(ctx, c.stage);
  await assertListCode(ctx.tx, c.tenantId, "document_type", input.typeCode, "typeCode", true);
  const id = crypto.randomUUID();
  const ext = input.fileName.includes(".") ? input.fileName.slice(input.fileName.lastIndexOf(".")).toLowerCase() : "";
  const key = `${opts.keyPrefix ?? "cases"}/${c.tenantId}/${c.id}/${id}${ext}`;
  const st = await storage();
  const ticket = await st.presignPut(key, { contentType: input.mimeType, sizeBytes: input.sizeBytes, expiresInSeconds: 300 });
  await ctx.tx.insert(schema.documents).values({ id, tenantId: c.tenantId, caseId: c.id, typeCode: input.typeCode, s3Key: key, fileName: input.fileName, mimeType: input.mimeType, sizeBytes: input.sizeBytes, sha256: PENDING, uploadedBy: ctx.auth.userId, uploadedAt: ctx.now, recordingConsent: input.typeCode === "CALL_RECORDING" ? true : null, retentionUntil: input.typeCode === "CALL_RECORDING" ? addDays(istDate(ctx.now), Number(await getSetting(c.tenantId, "recordings.retention_days", ctx.tx))) : null });
  return { id, uploadUrl: ticket.url, expiresAt: ticket.expiresAt, headers: ticket.headers };
}

export async function commitDocument(ctx: RequestContext, caseId: string, input: z.infer<typeof DocumentCommit>) {
  const c = await requireCase(ctx, caseId);
  const d = (await ctx.tx.select().from(schema.documents).where(and(eq(schema.documents.id, input.documentId), eq(schema.documents.caseId, c.id))).limit(1))[0];
  if (!d) throw errors.notFound("Document");
  if (d.sha256 !== PENDING) return documentOut(d); // idempotent
  if (d.typeCode === "CALL_RECORDING" && input.recordingConsent !== true) throw errors.validation("recordingConsent=true is required for CALL_RECORDING");
  const st = await storage();
  const head = await st.head(d.s3Key);
  if (!head) throw errors.validation("The file has not been uploaded yet");
  const actual = await st.sha256(d.s3Key);
  if (actual !== input.sha256) throw errors.validation("sha256 does not match the uploaded file", { expected: actual });
  const row = (await ctx.tx.update(schema.documents).set({ sha256: input.sha256, sizeBytes: head.sizeBytes || d.sizeBytes, recordingConsent: d.typeCode === "CALL_RECORDING" ? true : null }).where(eq(schema.documents.id, d.id)).returning())[0];
  await audit(ctx, { action: "document.upload", entityType: "document", entityId: d.id, caseId: c.id, after: { typeCode: d.typeCode, fileName: d.fileName, sha256: input.sha256 } });
  await emit(ctx, "document.uploaded", d.id, { caseId: c.id, typeCode: d.typeCode });
  return documentOut(row);
}

export async function downloadUrl(ctx: RequestContext, documentId: string) {
  const d = (await ctx.tx.select().from(schema.documents).where(and(eq(schema.documents.tenantId, ctx.auth.tenantId), eq(schema.documents.id, documentId), isNull(schema.documents.deletedAt))).limit(1))[0];
  if (!d || d.sha256 === PENDING) throw errors.notFound("Document");
  if (d.caseId) await requireCase(ctx, d.caseId); // visibility follows the case (FR-15.5)
  const st = await storage();
  const t = await st.presignGet(d.s3Key, { fileName: d.fileName, expiresInSeconds: 300 });
  await audit(ctx, { action: "document.download", entityType: "document", entityId: d.id, caseId: d.caseId, after: { fileName: d.fileName } });
  return { url: t.url, expiresAt: t.expiresAt };
}

export async function softDelete(ctx: RequestContext, documentId: string, reason: string) {
  const d = (await ctx.tx.select().from(schema.documents).where(and(eq(schema.documents.tenantId, ctx.auth.tenantId), eq(schema.documents.id, documentId), isNull(schema.documents.deletedAt))).limit(1))[0];
  if (!d) throw errors.notFound("Document");
  const usedByQuote = (await ctx.tx.select({ id: schema.quotes.id }).from(schema.quotes).where(eq(schema.quotes.documentId, d.id)).limit(1))[0];
  if (usedByQuote) throw errors.validation("This document is an EPC quote PDF and cannot be deleted");
  await ctx.tx.update(schema.documents).set({ deletedAt: ctx.now }).where(eq(schema.documents.id, d.id));
  await audit(ctx, { action: "document.delete", entityType: "document", entityId: d.id, caseId: d.caseId, reason, before: { fileName: d.fileName, typeCode: d.typeCode } });
}

/** Committed documents of a type on a case (used by installation and quote gates). */
export async function countDocuments(ctx: RequestContext, caseId: string, typeCode: string) {
  const rows = await ctx.tx.select({ id: schema.documents.id, sha256: schema.documents.sha256 }).from(schema.documents).where(and(eq(schema.documents.caseId, caseId), eq(schema.documents.typeCode, typeCode), isNull(schema.documents.deletedAt)));
  return rows.filter((r) => r.sha256 !== PENDING).length;
}

export async function requireCommittedDocument(ctx: RequestContext, caseId: string, documentId: string, typeCode?: string) {
  const d = (await ctx.tx.select().from(schema.documents).where(and(eq(schema.documents.id, documentId), eq(schema.documents.caseId, caseId), isNull(schema.documents.deletedAt))).limit(1))[0];
  if (!d || d.sha256 === PENDING) throw errors.validation("documentId must be a committed upload on this case");
  if (typeCode && d.typeCode !== typeCode) throw errors.validation(`Document must be of type ${typeCode}`);
  return d;
}
