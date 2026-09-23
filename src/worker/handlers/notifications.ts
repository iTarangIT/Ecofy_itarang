import { on } from "./registry";
import { EVENT_TYPES } from "@/core/events/types";
import { withSystemContext } from "@/core/db/tx";
import { createNotifications, notificationExists, type NotifyTarget } from "@/modules/m16-notifications/service";
import { now } from "../clock";

/**
 * Any event may carry `notify: NotifyTarget[]` in its payload (FR-16.1). Idempotent: the notification
 * type is suffixed with the outbox event id, so a redelivered event never creates a second bell entry.
 */
export function registerNotificationHandlers() {
  on([...EVENT_TYPES], async (e) => {
    const targets = e.payload.notify as NotifyTarget[] | undefined;
    if (!Array.isArray(targets) || !targets.length) return;
    await withSystemContext(e.tenantId, async (tx) => {
      const ctx = { requestId: `evt-${e.id}`, tenantId: e.tenantId, tx, now: now() };
      const stamped = targets.map((t) => ({ ...t, type: `${t.type}#${e.id}` }));
      const direct = stamped.filter((t) => t.userId).map((t) => t.userId as string);
      if (direct.length && (await notificationExists(ctx, stamped[0].type, direct))) return;
      await createNotifications(ctx, stamped);
    });
  });
}
