/**
 * Integration-test tenant. Uses OWNER_DATABASE_URL to create (once) a tenant "TEST" on host test.local
 * with the same defaults as the seeded ECOFY tenant, plus four users with fake Supabase ids.
 * Cases and other business rows of the TEST tenant are wiped before each test file.
 */
import postgres from "postgres";
import { randomUUID } from "node:crypto";

export const TEST_HOST = "test.local";
export type TestRole = "ECOFY_ADMIN" | "ECOFY_USER" | "ECOFY_USER_2" | "ITARANG_ADMIN" | "ITARANG_CALLER";
export type TestUser = { id: string; authUserId: string; email: string; role: Exclude<TestRole, "ECOFY_USER_2"> | "ECOFY_USER"; fullName: string };

let ownerSql: ReturnType<typeof postgres> | undefined;
export function owner() {
  if (!ownerSql) {
    const url = process.env.OWNER_DATABASE_URL;
    if (!url) throw new Error("OWNER_DATABASE_URL is required for integration tests");
    ownerSql = postgres(url, { ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : "require", prepare: false, max: 2, onnotice: () => {} });
  }
  return ownerSql;
}

export type TestTenant = { tenantId: string; ecofyOrgId: string; itarangOrgId: string; users: Record<TestRole, TestUser>; financierId: string; otherFinancierId: string; epcPartnerId: string };

const USERS: Array<{ key: TestRole; role: TestUser["role"]; email: string; fullName: string; org: "ECOFY" | "ITARANG" }> = [
  { key: "ECOFY_ADMIN", role: "ECOFY_ADMIN", email: "ea@test.local", fullName: "Ecofy Admin", org: "ECOFY" },
  { key: "ECOFY_USER", role: "ECOFY_USER", email: "eu1@test.local", fullName: "Ecofy User One", org: "ECOFY" },
  { key: "ECOFY_USER_2", role: "ECOFY_USER", email: "eu2@test.local", fullName: "Ecofy User Two", org: "ECOFY" },
  { key: "ITARANG_ADMIN", role: "ITARANG_ADMIN", email: "ia@test.local", fullName: "iTarang Admin", org: "ITARANG" },
  { key: "ITARANG_CALLER", role: "ITARANG_CALLER", email: "ic@test.local", fullName: "iTarang Caller", org: "ITARANG" },
];

export async function ensureTestTenant(): Promise<TestTenant> {
  const sql = owner();
  const existing = await sql<{ id: string }[]>`select id from tenants where code = 'ITEST'`;
  let tenantId: string;
  if (existing[0]) tenantId = existing[0].id;
  else {
    tenantId = (await sql<{ id: string }[]>`insert into tenants(code, name) values ('ITEST', 'Integration test tenant') returning id`)[0].id;
    await sql`insert into tenant_domains(tenant_id, host, is_primary) values (${tenantId}, ${TEST_HOST}, true)`;
    await sql`insert into orgs(tenant_id, kind, name) values (${tenantId}, 'ECOFY', 'Ecofy'), (${tenantId}, 'ITARANG', 'iTarang')`;
    // copy defaults from the seeded ECOFY tenant
    const src = (await sql<{ id: string }[]>`select id from tenants where code = 'ECOFY'`)[0]?.id;
    if (!src) throw new Error("Seed the ECOFY tenant first (npm run db:seed)");
    await sql`insert into settings(tenant_id, key, value) select ${tenantId}, key, value from settings where tenant_id = ${src}`;
    await sql`insert into list_items(tenant_id, list_code, code, label, sort_order, active) select ${tenantId}, list_code, code, label, sort_order, active from list_items where tenant_id = ${src}`;
    await sql`insert into working_hours(tenant_id, weekday, start_time, end_time) select ${tenantId}, weekday, start_time, end_time from working_hours where tenant_id = ${src}`;
    await sql`insert into financiers(tenant_id, name, is_default, values_visible_to) values (${tenantId}, 'Ecofy', true, 'ECOFY_ADMIN'), (${tenantId}, 'Other NBFC', false, 'ITARANG_ADMIN')`;
    await sql`insert into seat_limits(tenant_id, role, seat_limit, seats_used) values (${tenantId}, 'ECOFY_ADMIN', 1, 1), (${tenantId}, 'ECOFY_USER', 2, 2), (${tenantId}, 'ITARANG_ADMIN', 1, 1), (${tenantId}, 'ITARANG_CALLER', 1, 1)`;
    await sql`insert into epc_partners(tenant_id, name, contact_name, pincodes, segments) values (${tenantId}, 'EPC One', 'Ravi', '{122001,411001}', '{RESI,ESS,CI}')`;
    for (const u of USERS) {
      const orgId = (await sql<{ id: string }[]>`select id from orgs where tenant_id = ${tenantId} and kind = ${u.org}`)[0].id;
      await sql`insert into users(tenant_id, org_id, auth_user_id, full_name, email, role, status) values (${tenantId}, ${orgId}, ${randomUUID()}, ${u.fullName}, ${u.email}, ${u.role}, 'ACTIVE')`;
    }
    // published calculator release: copy the seed draft params + appliances, add one system per type
    const rel = (await sql<{ params: unknown }[]>`select params from calc_releases where tenant_id = ${src} and version = 1`)[0];
    const ia = (await sql<{ id: string }[]>`select id from users where tenant_id = ${tenantId} and role = 'ITARANG_ADMIN'`)[0].id;
    const relId = (await sql<{ id: string }[]>`insert into calc_releases(tenant_id, version, status, params, change_note, created_by, published_at) values (${tenantId}, 1, 'PUBLISHED', ${sql.json(rel.params as never)}, 'test', ${ia}, now()) returning id`)[0].id;
    await sql`insert into calc_appliances(tenant_id, release_id, name, default_watts, is_motor, start_multiplier, sort_order)
              select ${tenantId}, ${relId}, name, default_watts, is_motor, start_multiplier, sort_order from calc_appliances a join calc_releases r on r.id = a.release_id where r.tenant_id = ${src} and r.version = 1`;
    await sql`insert into calc_systems(tenant_id, release_id, system_code, system_name, for_resi, for_ess, for_ci, system_type, battery_capacity_kwh, usable_capacity_kwh, battery_chemistry, inverter_kva, inverter_type, phase, solar_kwp, equipment_price_min_inr, equipment_price_max_inr, installation_price_min_inr, installation_price_max_inr, gst_pct, price_updated_on) values
      (${tenantId}, ${relId}, 'RESI-S2-B3', '2 kWp solar + 3 kWh battery', true, false, false, 'SOLAR_STORAGE', 3, 2.7, 'LFP', 2.5, 'HYBRID', 'SINGLE', 2, 150000, 180000, 12000, 18000, 12, current_date),
      (${tenantId}, ${relId}, 'RESI-S3-B5', '3 kWp solar + 5 kWh battery', true, false, false, 'SOLAR_STORAGE', 5, 4.5, 'LFP', 5, 'HYBRID', 'SINGLE', 3, 210000, 250000, 15000, 25000, 12, current_date),
      (${tenantId}, ${relId}, 'RESI-S5-B10', '5 kWp solar + 10 kWh battery', true, true, false, 'SOLAR_STORAGE', 10, 9, 'LFP', 7.5, 'HYBRID', 'SINGLE', 5, 380000, 440000, 20000, 30000, 12, current_date),
      (${tenantId}, ${relId}, 'RESI-B5', '5 kWh storage, 5 kVA', true, true, false, 'STORAGE_ONLY', 5, 4.5, 'LFP', 5, 'OFF_GRID', 'SINGLE', 0, 120000, 150000, 8000, 12000, 12, current_date),
      (${tenantId}, ${relId}, 'RESI-S3', '3 kWp solar only', true, false, false, 'SOLAR_ONLY', 0, 0, null, 3, 'ON_GRID', 'SINGLE', 3, 140000, 170000, 10000, 15000, 12, current_date)`;
  }
  const orgs = await sql<{ id: string; kind: string }[]>`select id, kind from orgs where tenant_id = ${tenantId}`;
  const users = await sql<{ id: string; auth_user_id: string; email: string; role: string; full_name: string }[]>`select id, auth_user_id, email, role, full_name from users where tenant_id = ${tenantId}`;
  const fins = await sql<{ id: string; is_default: boolean }[]>`select id, is_default from financiers where tenant_id = ${tenantId}`;
  const epc = await sql<{ id: string }[]>`select id from epc_partners where tenant_id = ${tenantId} limit 1`;
  const byKey = {} as Record<TestRole, TestUser>;
  for (const u of USERS) {
    const row = users.find((r) => r.email === u.email)!;
    byKey[u.key] = { id: row.id, authUserId: row.auth_user_id, email: row.email, role: row.role as TestUser["role"], fullName: row.full_name };
  }
  return {
    tenantId,
    ecofyOrgId: orgs.find((o) => o.kind === "ECOFY")!.id,
    itarangOrgId: orgs.find((o) => o.kind === "ITARANG")!.id,
    users: byKey,
    financierId: fins.find((f) => f.is_default)!.id,
    otherFinancierId: fins.find((f) => !f.is_default)!.id,
    epcPartnerId: epc[0].id,
  };
}

/** Removes business data of the TEST tenant (keeps tenant, orgs, users, settings, lists, calendar, financiers, release). */
export async function resetTestData(tenantId: string) {
  const sql = owner();
  const tables = [
    "asset_events", "emi_status_updates", "assets", "disbursements", "down_payments", "installation_events", "installations",
    "financing_values", "financing_decisions", "file_acceptances", "files", "otp_challenges", "offers", "quotes", "quote_requests",
    "eligibility_values", "eligibility_checks", "assessments", "withdrawals", "appointments", "activities", "documents",
    "case_returns", "case_assignments", "case_stage_history", "notifications", "sms_messages", "idempotency_keys", "outbox_events",
    "import_rows", "import_batches", "column_mappings", "cases", "customers", "audit_log", "funnel_daily",
  ];
  for (const t of tables) await sql.unsafe(`delete from ${t} where tenant_id = '${tenantId}'`);
  // reset case_no sequence not needed; keep calc release v1 only
  await sql`delete from list_items where tenant_id = ${tenantId} and (list_code, code) not in (select list_code, code from list_items where tenant_id = (select id from tenants where code='ECOFY'))`;
  await sql`delete from calc_releases where tenant_id = ${tenantId} and version <> 1`;
  await sql`update calc_releases set status = 'PUBLISHED' where tenant_id = ${tenantId} and version = 1`;
  // users created by tests (not fixtures) are removed; seat caps go back to the fixture values
  const fixtureEmails = USERS.map((u) => u.email);
  await sql`delete from seat_ledger where tenant_id = ${tenantId}`;
  await sql`delete from user_sessions where tenant_id = ${tenantId} and user_id in (select id from users where tenant_id = ${tenantId} and email <> all(${fixtureEmails}))`;
  await sql`delete from trusted_devices where tenant_id = ${tenantId} and user_id in (select id from users where tenant_id = ${tenantId} and email <> all(${fixtureEmails}))`;
  await sql`delete from users where tenant_id = ${tenantId} and email <> all(${fixtureEmails})`;
  await sql`update users set status = 'ACTIVE', deactivated_at = null where tenant_id = ${tenantId}`;
  await sql`update seat_limits set seat_limit = case role when 'ECOFY_ADMIN' then 1 when 'ECOFY_USER' then 2 when 'ITARANG_ADMIN' then 1 else 1 end where tenant_id = ${tenantId}`;
  await sql`update seat_limits set seats_used = (select count(*) from users u where u.tenant_id = ${tenantId} and u.role = seat_limits.role and u.status = 'ACTIVE') where tenant_id = ${tenantId}`;
  await sql`update settings set value = s.value from (select key, value from settings where tenant_id = (select id from tenants where code='ECOFY')) s where settings.tenant_id = ${tenantId} and settings.key = s.key`;
}

export async function closeOwner() {
  await ownerSql?.end();
  ownerSql = undefined;
}
