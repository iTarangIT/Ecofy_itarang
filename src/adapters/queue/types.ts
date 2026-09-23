import type { OutboxEvent } from "@/core/events/types";

/**
 * Queue port. Both drivers are fed by the outbox relay running in the worker:
 *  - inline: the relay dispatches to the registered handlers in-process (dev/test)
 *  - bullmq: the relay publishes to Redis; BullMQ workers dispatch to the same handlers
 */
export type EventHandler = (event: OutboxEvent) => Promise<void>;

export interface Queue {
  readonly driver: "inline" | "bullmq";
  publish(event: OutboxEvent): Promise<void>;
  /** Start consuming (worker process only). */
  start(dispatch: EventHandler): Promise<void>;
  stop(): Promise<void>;
  ping(): Promise<boolean>;
}
