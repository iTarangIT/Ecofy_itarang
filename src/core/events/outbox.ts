import { schema } from "@/core/db/client";
import { tenantOf, type ActorContext } from "@/core/http/context";
import type { EventType } from "./types";

/**
 * Transactional outbox (BRD §3.2, §8): the event row commits with the business change;
 * the worker relay publishes it (at-least-once, handlers idempotent).
 */
export async function emit(ctx: ActorContext, eventType: EventType, aggregateId: string, payload: Record<string, unknown> = {}) {
  await ctx.tx.insert(schema.outboxEvents).values({
    tenantId: tenantOf(ctx),
    eventType,
    aggregateId,
    payload: { ...payload, tenantId: tenantOf(ctx), at: ctx.now.toISOString() },
  });
}
