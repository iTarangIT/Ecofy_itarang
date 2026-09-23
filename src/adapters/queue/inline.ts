import type { OutboxEvent } from "@/core/events/types";
import type { Queue, EventHandler } from "./types";

/** In-process queue: publish() dispatches straight to the handler (awaited by the relay). */
export class InlineQueue implements Queue {
  readonly driver = "inline" as const;
  private dispatch: EventHandler | null = null;
  async publish(event: OutboxEvent) {
    if (!this.dispatch) throw new Error("inline queue not started");
    await this.dispatch(event);
  }
  async start(dispatch: EventHandler) {
    this.dispatch = dispatch;
  }
  async stop() {
    this.dispatch = null;
  }
  async ping() {
    return true;
  }
}
