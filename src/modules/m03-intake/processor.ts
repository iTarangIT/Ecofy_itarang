/**
 * import.process job entry point (M03, FR-03.5): validates, dedupes and writes rows in chunks of 500
 * in the uploader's RLS context, then builds the report. Implemented with the intake service.
 */
export type ProcessImportInput = { tenantId: string; batchId: string; uploaderId: string; uploaderRole: "ECOFY_ADMIN" | "ITARANG_ADMIN" };

export async function processImport(input: ProcessImportInput): Promise<void> {
  const { runImportBatch } = await import("./service");
  await runImportBatch(input);
}
