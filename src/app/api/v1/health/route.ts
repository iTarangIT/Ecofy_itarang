import { sql } from "drizzle-orm";
import { route } from "@/core/http/route";
import { ok } from "@/core/http/envelope";
import { db } from "@/core/db/client";
import { storage, queue } from "@/adapters";

/** GET /health — public, no data: DB, queue (Redis when bullmq) and storage checks for uptime monitoring. */
export const GET = route({ roles: "public" }, async () => {
  const checks = { db: false, redis: false, s3: false };
  try { await db.execute(sql`select 1`); checks.db = true; } catch { /* down */ }
  try { checks.redis = await (await queue()).ping(); } catch { /* down */ }
  try { checks.s3 = await (await storage()).ping(); } catch { /* down */ }
  return ok(checks, { status: checks.db ? 200 : 503 });
});
