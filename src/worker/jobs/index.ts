import { withSystemContext } from "@/core/db/tx";
import type { SystemContext } from "@/core/http/context";
import { now } from "../clock";
import { randomUUID } from "node:crypto";

export type JobResult = Record<string, number | string | undefined>;
export type JobFn = (ctx: SystemContext) => Promise<JobResult>;

/** Background jobs — BRD §8.2 (cron in IST). Each job runs per tenant inside a system context. */
export type JobDef = { name: string; schedule: string; run: JobFn };

const registry = new Map<string, JobDef>();

export function defineJob(def: JobDef) {
  registry.set(def.name, def);
  return def;
}

export const JOBS: JobDef[] = [];

export async function runJob(name: string, tenantId: string): Promise<JobResult> {
  const def = registry.get(name);
  if (!def) throw new Error(`unknown job ${name}`);
  return withSystemContext(tenantId, (tx) => def.run({ requestId: `job-${randomUUID()}`, tenantId, tx, now: now() }));
}

export function registerJobs(defs: JobDef[]) {
  for (const d of defs) {
    registry.set(d.name, d);
    if (!JOBS.find((j) => j.name === d.name)) JOBS.push(d);
  }
}

export function jobByName(name: string) {
  return registry.get(name);
}
