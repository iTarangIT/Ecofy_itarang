import { registerJobs } from "../jobs";
import { maintenanceJobs } from "../jobs/maintenance";
import { registerNotificationHandlers } from "./notifications";
import { registerMessagingHandlers } from "./messaging";
import { registerImportHandlers } from "./imports";
import { registerSettingsHandlers } from "./settings";
import { registerCrmSyncHandlers } from "./crmSync";

let done = false;

/** Registers every event handler and every scheduled job exactly once per process. */
export function registerAllHandlers() {
  if (done) return;
  done = true;
  registerNotificationHandlers();
  registerMessagingHandlers();
  registerImportHandlers();
  registerSettingsHandlers();
  registerCrmSyncHandlers();
  registerJobs(maintenanceJobs);
}
