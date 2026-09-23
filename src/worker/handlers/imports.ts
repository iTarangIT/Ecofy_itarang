import { on } from "./registry";
import { processImport } from "@/modules/m03-intake/processor";

/** job.import.process payload: { batchId, uploaderId, uploaderRole } — runs in the uploader's context (RLS WITH CHECK). */
export function registerImportHandlers() {
  on("job.import.process", async (e) => {
    const p = e.payload as unknown as { batchId: string; uploaderId: string; uploaderRole: "ECOFY_ADMIN" | "ITARANG_ADMIN" };
    await processImport({ tenantId: e.tenantId, batchId: p.batchId, uploaderId: p.uploaderId, uploaderRole: p.uploaderRole });
  });
}
