import { and, eq, isNull, sql } from "drizzle-orm";
import { schema } from "@/core/db/client";
import { withSystemContext } from "@/core/db/tx";
import { logger } from "@/core/http/logger";
import type { OutboxEvent } from "@/core/events/types";
import type { Queue } from "@/adapters/queue/types";

/**
 * outbox.relay (BRD §8.2): every 2 seconds, per tenant, publish unpublished outbox rows in id order and
 * mark published_at. Rows are locked with SKIP LOCKED so two relays never double-publish.
 * With the inline queue, publish() runs the handlers synchronously; a handler failure leaves the row
 * unpublished for the next tick (at-least-once).
 */
export async function relayOnce(tenantId: string, queue: Queue, batch = 100): Promise<number> {
  return withSystemContext(tenantId, async (tx) => {
    const rows = await tx
      .select()
      .from(schema.outboxEvents)
      .where(and(eq(schema.outboxEvents.tenantId, tenantId), isNull(schema.outboxEvents.publishedAt)))
      .orderBy(schema.outboxEvents.id)
      .limit(batch)
      .for("update", { skipLocked: true });
    let n = 0;
    for (const r of rows) {
      const event: OutboxEvent = {
        id: Number(r.id),
        tenantId: r.tenantId,
        eventType: r.eventType as OutboxEvent["eventType"],
        aggregateId: r.aggregateId,
        payload: r.payload as OutboxEvent["payload"],
        createdAt: new Date(r.createdAt),
      };
      try {
        await queue.publish(event);
        await tx.update(schema.outboxEvents).set({ publishedAt: sql`now()` }).where(eq(schema.outboxEvents.id, r.id));
        n++;
      } catch (err) {
        logger.error({ err, eventId: event.id, eventType: event.eventType }, "relay: publish failed; will retry");
        break; // keep order; retry from this row next tick
      }
    }
    return n;
  });
}
