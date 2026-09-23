import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/core/db/client";
import { withSystemContext } from "@/core/db/tx";

/**
 * Settings (M02, FR-02.6): served from a cache, invalidated on change. Two processes (web, worker)
 * each cache with a short TTL; the worker also invalidates on the `setting.changed` event.
 * Defaults mirror ecofy_seed_v1.1.sql so a missing row never crashes a gate.
 */
export const SETTING_DEFAULTS = {
  "intake.max_rows": 5000,
  "intake.consent_attestation_text":
    "I confirm Ecofy holds consent from every customer in this file to be contacted about solar and storage products by Ecofy and iTarang on its behalf.",
  "imports.raw_retention_days": 30,
  "permissions.ecofy_docs_after_handoff": false,
  "recordings.retention_days": 60,
  "ageing.bands_working_days": [1, 3, 7],
  "gates.meeting_before_assessment": true,
  "gates.s4_order": "ELIGIBILITY_FIRST",
  "gates.sanction_before_installation": false,
  "gates.down_payment_before_installation": false,
  "gates.allow_provisional_quote_acceptance": true,
  "quotes.default_validity_days": 30,
  "otp.length": 6,
  "otp.expiry_minutes": 10,
  "otp.max_attempts": 5,
  "otp.resend_after_seconds": 60,
  "otp.max_sends_per_offer_per_hour": 3,
  "sms.sender_id": null,
  "sms.dlt_template_acceptance": null,
  "sms.dlt_template_reacceptance": null,
  /** false: skip the new-device email code (FR-01.2/1.3) — every device is trusted at sign-in. Staging/dev only. */
  "auth.device_verification_required": true,
  "auth.device_otp_expiry_minutes": 10,
  "auth.device_otp_max_attempts": 5,
  "auth.device_lockout_minutes": 15,
  "auth.trusted_device_days": 30,
  "systems.price_refresh_days": 30,
  "appointments.reminder_minutes_before": 60,
  "notifications.admin_daily_digest": false,
  "exports.mask_mobile_in_lists": true,
  "idempotency.ttl_hours": 24,
  "billing.usage_view_enabled": true,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K] extends null ? string | null : (typeof SETTING_DEFAULTS)[K];

const TTL_MS = 30_000;
const cache = new Map<string, { value: unknown; at: number }>();

export async function getSetting<K extends SettingKey>(tenantId: string, key: K, tx?: Tx): Promise<SettingValue<K>> {
  const ck = `${tenantId}:${key}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as SettingValue<K>;
  const read = async (t: Tx) => {
    const rows = await t.select({ value: schema.settings.value }).from(schema.settings).where(and(eq(schema.settings.tenantId, tenantId), eq(schema.settings.key, key))).limit(1);
    return rows[0]?.value;
  };
  const value = tx ? await read(tx) : await withSystemContext(tenantId, read);
  const resolved = value === undefined ? SETTING_DEFAULTS[key] : value;
  cache.set(ck, { value: resolved, at: Date.now() });
  return resolved as SettingValue<K>;
}

export async function getAllSettings(tenantId: string, tx: Tx): Promise<Record<string, unknown>> {
  const rows = await tx.select({ key: schema.settings.key, value: schema.settings.value }).from(schema.settings).where(eq(schema.settings.tenantId, tenantId));
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function invalidateSetting(tenantId: string, key?: string) {
  if (!key) {
    for (const k of [...cache.keys()]) if (k.startsWith(`${tenantId}:`)) cache.delete(k);
    return;
  }
  cache.delete(`${tenantId}:${key}`);
}

export function clearSettingsCache() {
  cache.clear();
}
