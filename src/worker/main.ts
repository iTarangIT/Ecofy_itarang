// ecofy-worker (PM2): outbox relay + scheduled jobs. Never connects as the owner role.
import "dotenv/config";
process.env.ECOFY_PROCESS = "ecofy-worker";
import { Cron } from "croner";
import { logger } from "@/core/http/logger";
import { queue } from "@/adapters";
import { relayOnce } from "./relay";
import { activeTenants } from "./tenants";
import { dispatch, registeredTypes } from "./handlers/registry";
import { registerAllHandlers } from "./handlers";
import { JOBS, runJob } from "./jobs";

const IST = "Asia/Kolkata";

async function main() {
  registerAllHandlers();
  const q = await queue();
  await q.start(dispatch);
  logger.info({ driver: q.driver, handlers: registeredTypes().length }, "worker started");

  let relaying = false;
  const relay = async () => {
    if (relaying) return;
    relaying = true;
    try {
      for (const t of await activeTenants()) {
        let n = 0;
        do n = await relayOnce(t.tenantId, q);
        while (n > 0);
      }
    } catch (err) {
      logger.error({ err }, "relay tick failed");
    } finally {
      relaying = false;
    }
  };
  const relayTimer = setInterval(relay, 2000);
  void relay();

  const crons: Cron[] = [];
  for (const job of JOBS) {
    crons.push(
      new Cron(job.schedule, { timezone: IST, protect: true, name: job.name }, async () => {
        for (const t of await activeTenants()) {
          try {
            const r = await runJob(job.name, t.tenantId);
            logger.info({ job: job.name, tenant: t.host, ...r }, "job done");
          } catch (err) {
            logger.error({ err, job: job.name, tenant: t.host }, "job failed");
          }
        }
      }),
    );
  }
  logger.info({ jobs: JOBS.map((j) => `${j.name}@${j.schedule}`) }, "schedules registered");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker stopping");
    clearInterval(relayTimer);
    for (const c of crons) c.stop();
    await q.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.fatal({ err }, "worker failed to start");
  process.exit(1);
});
