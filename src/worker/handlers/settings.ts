import { on } from "./registry";
import { invalidateSetting } from "@/core/settings/settingsCache";

/** The worker keeps its own settings cache; invalidate on change (FR-02.6). */
export function registerSettingsHandlers() {
  on("setting.changed", async (e) => {
    invalidateSetting(e.tenantId, typeof e.payload.key === "string" ? e.payload.key : undefined);
  });
}
