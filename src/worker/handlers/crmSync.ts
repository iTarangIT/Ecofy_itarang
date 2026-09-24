import { on } from "./registry";
import { enqueueFromEvent } from "@/modules/m18-crm-sync/outbound";
import { now } from "../clock";

/**
 * iTarang CRM sync (docs/ITARANG_CRM_SYNC.md): queue a delivery for pushed / Hot leads and their later
 * stage changes. No network here — `deliverDue` (worker loop) sends. Idempotent per outbox event id.
 */
export function registerCrmSyncHandlers() {
  on(["case.pushed", "case.temperature_set", "case.stage_changed"], async (e) => {
    await enqueueFromEvent(e, now());
  });
}
