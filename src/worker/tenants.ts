import { config } from "@/core/config";
import { resolveTenant } from "@/core/auth/tenant";

/** Tenants served by this worker: resolved from TENANT_HOSTS through resolve_tenant() (the only pre-tenant lookup). */
export async function activeTenants(): Promise<Array<{ host: string; tenantId: string }>> {
  const out: Array<{ host: string; tenantId: string }> = [];
  for (const host of config().tenantHosts) {
    const tenantId = await resolveTenant(host);
    if (tenantId) out.push({ host, tenantId });
  }
  return out;
}
