import type { OutboxEvent, EventType } from "@/core/events/types";
import { logger } from "@/core/http/logger";

export type Handler = (event: OutboxEvent) => Promise<void>;

const handlers = new Map<EventType, Handler[]>();

export function on(type: EventType | EventType[], handler: Handler) {
  for (const t of Array.isArray(type) ? type : [type]) {
    const list = handlers.get(t) ?? [];
    list.push(handler);
    handlers.set(t, list);
  }
}

/** Dispatches one event to every handler registered for its type. Handlers must be idempotent. */
export async function dispatch(event: OutboxEvent): Promise<void> {
  const list = handlers.get(event.eventType) ?? [];
  for (const h of list) {
    try {
      await h(event);
    } catch (err) {
      logger.error({ err, eventId: event.id, eventType: event.eventType }, "handler failed");
      throw err;
    }
  }
}

export function registeredTypes(): EventType[] {
  return [...handlers.keys()];
}

export function clearHandlers() {
  handlers.clear();
}
