import { Queue as BullQueue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "@/core/config";
import { logger } from "@/core/http/logger";
import type { OutboxEvent } from "@/core/events/types";
import type { Queue, EventHandler } from "./types";

const QUEUE_NAME = "events";
const PREFIX = "ecofy";

/**
 * BullMQ on Redis (prefix `ecofy:`). Two connections on purpose: BullMQ blocking clients need
 * maxRetriesPerRequest: null; everything else keeps a bounded retry budget.
 */
export class BullMqQueue implements Queue {
  readonly driver = "bullmq" as const;
  private readonly url: string;
  private producer?: BullQueue;
  private worker?: Worker;
  private producerConn?: IORedis;
  private blockingConn?: IORedis;

  constructor() {
    const url = config().REDIS_URL;
    if (!url) throw new Error("REDIS_URL is required for QUEUE_DRIVER=bullmq");
    this.url = url;
  }

  private getProducer() {
    if (!this.producer) {
      this.producerConn = new IORedis(this.url, { maxRetriesPerRequest: 2, lazyConnect: true, enableOfflineQueue: true });
      this.producer = new BullQueue(QUEUE_NAME, { connection: this.producerConn, prefix: PREFIX, defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: 1000, removeOnFail: 5000 } });
    }
    return this.producer;
  }

  async publish(event: OutboxEvent) {
    await this.getProducer().add(event.eventType, event, { jobId: `outbox-${event.id}` });
  }

  async start(dispatch: EventHandler) {
    this.blockingConn = new IORedis(this.url, { maxRetriesPerRequest: null, lazyConnect: true, enableOfflineQueue: true });
    this.worker = new Worker(QUEUE_NAME, async (job: Job<OutboxEvent>) => dispatch(job.data), { connection: this.blockingConn, prefix: PREFIX, concurrency: 5 });
    this.worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err }, "bullmq job failed"));
  }

  async stop() {
    await this.worker?.close();
    await this.producer?.close();
    this.producerConn?.disconnect();
    this.blockingConn?.disconnect();
  }

  async ping() {
    try {
      const c = new IORedis(this.url, { maxRetriesPerRequest: 1, lazyConnect: true });
      await c.connect();
      const r = await c.ping();
      c.disconnect();
      return r === "PONG";
    } catch {
      return false;
    }
  }
}
