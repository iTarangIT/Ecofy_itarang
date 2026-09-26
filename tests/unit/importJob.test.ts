import { describe, it, expect } from "vitest";
import { errors } from "@/core/http/errors";
import { isTerminalImportError } from "@/modules/m03-intake/processor";

/** The import.process job must not poison the outbox relay: 4xx batch errors are terminal, 5xx/driver errors retry. */
describe("import job — terminal vs retryable errors", () => {
  it("treats validation / not-found / gate errors as terminal", () => {
    expect(isTerminalImportError(errors.validation("The file has not been uploaded yet"))).toBe(true);
    expect(isTerminalImportError(errors.notFound("Import"))).toBe(true);
    expect(isTerminalImportError(errors.gate("consent", "Consent not attested"))).toBe(true);
  });

  it("keeps infrastructure failures retryable", () => {
    expect(isTerminalImportError(errors.internal("Unexpected error"))).toBe(false);
    expect(isTerminalImportError(new Error("connection refused"))).toBe(false);
    expect(isTerminalImportError(undefined)).toBe(false);
  });
});
