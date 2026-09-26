import { isAppError } from "@/core/http/errors";
import { logger } from "@/core/http/logger";

/**
 * import.process job entry point (M03, FR-03.5): validates, dedupes and writes rows in chunks of 500
 * in the uploader's RLS context, then builds the report. Implemented with the intake service.
 *
 * Terminal failures. The outbox relay retries a failed handler for ever, in order, so one job that can
 * never succeed (the batch file is gone, the mapping no longer validates) would block every later event
 * of the tenant — including CRM deliveries. A 4xx AppError from the batch is such a failure: the batch
 * is marked FAILED (audit + notification for the uploader) and the job completes. 5xx / driver errors
 * (DB down, storage down) are still thrown so the relay retries them.
 */
export type ProcessImportInput = { tenantId: string; batchId: string; uploaderId: string; uploaderRole: "ECOFY_ADMIN" | "ITARANG_ADMIN" };

/** True when retrying the job cannot help: the batch itself is invalid, not the infrastructure. */
export function isTerminalImportError(err: unknown): err is { message: string; status: number } {
  return isAppError(err) && err.status >= 400 && err.status < 500;
}

export async function processImport(input: ProcessImportInput): Promise<void> {
  const { runImportBatch, failImportBatch } = await import("./service");
  try {
    await runImportBatch(input);
  } catch (err) {
    if (!isTerminalImportError(err)) throw err;
    const failed = await failImportBatch(input, err.message);
    logger.error({ batchId: input.batchId, reason: err.message, marked: failed }, "import job failed permanently; batch marked FAILED");
  }
}
