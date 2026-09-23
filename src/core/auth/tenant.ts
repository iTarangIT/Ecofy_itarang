import { sql } from "drizzle-orm";
import { db } from "@/core/db/client";

const cache = new Map<string, { id: string | null; at: number }>();
const TTL_MS = 60_000;

/**
 * Host → tenant through resolve_tenant() (SECURITY DEFINER): the only lookup allowed before
 * app.tenant_id is set. Unknown host → null (the route wrapper answers 404).
 */
export async function resolveTenant(host: string | null): Promise<string | null> {
  if (!host) return null;
  const key = host.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.id;
  const rows = (await db.execute(sql`select resolve_tenant(${key}) as id`)) as unknown as Array<{ id: string | null }>;
  const id = rows[0]?.id ?? null;
  cache.set(key, { id, at: Date.now() });
  return id;
}

export function clearTenantCache() {
  cache.clear();
}

/** Normalise the Host header (strip default ports, lowercase). */
export function normaliseHost(raw: string | null): string | null {
  if (!raw) return null;
  const h = raw.trim().toLowerCase();
  return h.replace(/:(80|443)$/, "");
}
