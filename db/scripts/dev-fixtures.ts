/**
 * Development fixtures — LOCAL / STAGING ONLY. Never run against production.
 *
 * Creates, idempotently, for the tenant on TENANT_HOSTS[0]:
 *   - Supabase Auth users (email + password, confirmed) for one user per role: IA (the seeded admin),
 *     EA, EU x2, IC — and links them to platform `users` rows (seat counters + ledger kept honest)
 *   - one EPC partner ("EPC One") and one non-default financier ("Other NBFC", values visible to IA)
 *   - standard systems on Calculator Release v1 and publishes it (the seed leaves it DRAFT)
 *
 * Usage:  npm run db:fixtures            (password from DEV_FIXTURE_PASSWORD, else generated and printed)
 * Needs:  OWNER_DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
import dotenv from "dotenv";
import path from "node:path";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const env = process.env;
if (env.NODE_ENV === "production") fail("Refusing to run fixtures with NODE_ENV=production");
const host = (env.TENANT_HOSTS ?? "localhost:3000").split(",")[0].trim().toLowerCase();
if (/itarang\.com$/.test(host) && !process.argv.includes("--i-know-this-is-staging")) {
  fail(`TENANT_HOSTS[0] is ${host}; pass --i-know-this-is-staging to seed fixtures on a hosted environment`);
}
const ownerUrl = env.OWNER_DATABASE_URL ?? fail("OWNER_DATABASE_URL is required");
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? fail("NEXT_PUBLIC_SUPABASE_URL is required");
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? fail("SUPABASE_SERVICE_ROLE_KEY is required");
const password = env.DEV_FIXTURE_PASSWORD || `Ecofy-${randomBytes(6).toString("base64url")}!`;
const iaEmail = (env.SEED_IA_EMAIL || "ia@ecofy.local").toLowerCase();
const domain = iaEmail.split("@")[1] ?? "ecofy.local";

type Role = "ITARANG_ADMIN" | "ITARANG_CALLER" | "ECOFY_ADMIN" | "ECOFY_USER";
const FIXTURE_USERS: Array<{ email: string; fullName: string; role: Role; org: "ECOFY" | "ITARANG" }> = [
  { email: iaEmail, fullName: env.SEED_IA_NAME || "iTarang Admin", role: "ITARANG_ADMIN", org: "ITARANG" },
  { email: `ic@${domain}`, fullName: "iTarang Caller", role: "ITARANG_CALLER", org: "ITARANG" },
  { email: `ea@${domain}`, fullName: "Ecofy Admin", role: "ECOFY_ADMIN", org: "ECOFY" },
  { email: `eu1@${domain}`, fullName: "Ecofy User One", role: "ECOFY_USER", org: "ECOFY" },
  { email: `eu2@${domain}`, fullName: "Ecofy User Two", role: "ECOFY_USER", org: "ECOFY" },
];

const SYSTEMS = [
  ["RESI-S2-B3", "2 kWp solar + 3 kWh battery", true, false, "SOLAR_STORAGE", 3, 2.7, "LFP", 2.5, "HYBRID", 2, 150000, 180000, 12000, 18000],
  ["RESI-S3-B5", "3 kWp solar + 5 kWh battery", true, false, "SOLAR_STORAGE", 5, 4.5, "LFP", 5, "HYBRID", 3, 210000, 250000, 15000, 25000],
  ["RESI-S5-B10", "5 kWp solar + 10 kWh battery", true, true, "SOLAR_STORAGE", 10, 9, "LFP", 7.5, "HYBRID", 5, 380000, 440000, 20000, 30000],
  ["RESI-B5", "5 kWh storage, 5 kVA", true, true, "STORAGE_ONLY", 5, 4.5, "LFP", 5, "OFF_GRID", 0, 120000, 150000, 8000, 12000],
  ["RESI-S3", "3 kWp solar only", true, false, "SOLAR_ONLY", 0, 0, null, 3, "ON_GRID", 3, 140000, 170000, 10000, 15000],
] as const;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const sql = postgres(ownerUrl, { ssl: /localhost|127\.0\.0\.1/.test(ownerUrl) ? undefined : "require", prepare: false, max: 2, onnotice: () => {} });
  const supa = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const tenant = (await sql<{ id: string; code: string }[]>`select t.id, t.code from tenants t join tenant_domains d on d.tenant_id = t.id where d.host = ${host} limit 1`)[0];
    if (!tenant) fail(`No tenant for host ${host}; run npm run db:seed first`);
    console.log(`Tenant ${tenant.code} (${host})`);
    const orgs = await sql<{ id: string; kind: string }[]>`select id, kind from orgs where tenant_id = ${tenant.id}`;
    const orgId = (kind: string) => orgs.find((o) => o.kind === kind)?.id ?? fail(`Org ${kind} missing`);

    // 1. Supabase Auth users — create or reset the password so the printed login always works.
    const authIds = new Map<string, string>();
    for (const u of FIXTURE_USERS) {
      const created = await supa.auth.admin.createUser({ email: u.email, password, email_confirm: true, user_metadata: { full_name: u.fullName, fixture: true } });
      if (created.data.user) {
        authIds.set(u.email, created.data.user.id);
        continue;
      }
      const existing = await findAuthUser(supa, u.email);
      if (!existing) fail(`Supabase: cannot create ${u.email}: ${created.error?.message ?? "unknown error"}`);
      const upd = await supa.auth.admin.updateUserById(existing, { password, email_confirm: true });
      if (upd.error) fail(`Supabase: cannot reset password for ${u.email}: ${upd.error.message}`);
      authIds.set(u.email, existing);
    }

    // 2. Platform users (link auth ids; seeded IA row exists as INVITED)
    const ia = (await sql<{ id: string }[]>`select id from users where tenant_id = ${tenant.id} and email = ${iaEmail}`)[0] ?? fail(`Seeded iTarang Admin ${iaEmail} not found; check SEED_IA_EMAIL`);
    for (const u of FIXTURE_USERS) {
      const authId = authIds.get(u.email)!;
      const row = (await sql<{ id: string }[]>`select id from users where tenant_id = ${tenant.id} and email = ${u.email}`)[0];
      if (row) {
        await sql`update users set auth_user_id = ${authId}, status = 'ACTIVE', deactivated_at = null, full_name = ${u.fullName} where id = ${row.id}`;
      } else {
        const ins = (await sql<{ id: string }[]>`insert into users(tenant_id, org_id, auth_user_id, full_name, email, role, status, created_by)
          values (${tenant.id}, ${orgId(u.org)}, ${authId}, ${u.fullName}, ${u.email}, ${u.role}, 'ACTIVE', ${ia.id}) returning id`)[0];
        await sql`insert into seat_ledger(tenant_id, role, action, user_id, actor_id) values (${tenant.id}, ${u.role}, 'SEAT_ADDED', ${ins.id}, ${ia.id})`;
      }
    }
    // seat counters = active users per role; if someone already invited real users, raise the cap (ledgered) rather than fail
    const active = await sql<{ role: Role; n: number; seat_limit: number }[]>`select sl.role, sl.seat_limit, (select count(*)::int from users u where u.tenant_id = sl.tenant_id and u.role = sl.role and u.status = 'ACTIVE') as n from seat_limits sl where sl.tenant_id = ${tenant.id}`;
    for (const a of active) {
      if (a.n > a.seat_limit) {
        await sql`insert into seat_ledger(tenant_id, role, action, old_limit, new_limit, actor_id) values (${tenant.id}, ${a.role}, 'LIMIT_CHANGED', ${a.seat_limit}, ${a.n}, ${ia.id})`;
        await sql`update seat_limits set seat_limit = ${a.n} where tenant_id = ${tenant.id} and role = ${a.role}`;
        console.log(`  seat cap for ${a.role} raised ${a.seat_limit} -> ${a.n} (existing users)`);
      }
    }
    await sql`update seat_limits set seats_used = (select count(*) from users u where u.tenant_id = seat_limits.tenant_id and u.role = seat_limits.role and u.status = 'ACTIVE') where tenant_id = ${tenant.id}`;

    // 3. EPC partner + second financier
    await sql`insert into epc_partners(tenant_id, name, contact_name, mobile_e164, email, pincodes, segments)
      values (${tenant.id}, 'EPC One', 'Ravi Kumar', '+919800000001', ${"epc1@" + domain}, '{122001,411001,560001}', '{RESI,ESS,CI}')
      on conflict (tenant_id, name) do nothing`;
    await sql`insert into financiers(tenant_id, name, is_default, values_visible_to) values (${tenant.id}, 'Other NBFC', false, 'ITARANG_ADMIN') on conflict (tenant_id, name) do nothing`;

    // 4. Calculator release v1: add standard systems, publish
    const rel = (await sql<{ id: string; status: string }[]>`select id, status from calc_releases where tenant_id = ${tenant.id} and version = 1`)[0] ?? fail("Calculator release v1 missing; run npm run db:seed");
    const sysCount = (await sql<{ n: number }[]>`select count(*)::int as n from calc_systems where release_id = ${rel.id}`)[0].n;
    if (sysCount === 0) {
      for (const s of SYSTEMS) {
        await sql`insert into calc_systems(tenant_id, release_id, system_code, system_name, for_resi, for_ess, for_ci, system_type, battery_capacity_kwh, usable_capacity_kwh, battery_chemistry, inverter_kva, inverter_type, phase, solar_kwp, battery_warranty_years, inverter_warranty_years, equipment_price_min_inr, equipment_price_max_inr, installation_price_min_inr, installation_price_max_inr, gst_pct, price_updated_on)
          values (${tenant.id}, ${rel.id}, ${s[0]}, ${s[1]}, ${s[2]}, ${s[3]}, false, ${s[4]}, ${s[5]}, ${s[6]}, ${s[7]}, ${s[8]}, ${s[9]}, 'SINGLE', ${s[10]}, 5, 5, ${s[11]}, ${s[12]}, ${s[13]}, ${s[14]}, 12, current_date)`;
      }
    }
    const published = (await sql<{ id: string }[]>`select id from calc_releases where tenant_id = ${tenant.id} and status = 'PUBLISHED'`)[0];
    if (!published) {
      const ea = (await sql<{ id: string }[]>`select id from users where tenant_id = ${tenant.id} and role = 'ECOFY_ADMIN' limit 1`)[0];
      await sql`update calc_releases set status = 'PUBLISHED', submitted_at = coalesce(submitted_at, now()), decided_by = ${ea.id}, decided_at = now(), decision_note = 'dev fixtures', published_at = now() where id = ${rel.id}`;
    }

    console.log("\nFixtures ready. Logins (Supabase Auth, email + password):");
    console.log(`  password: ${password}`);
    for (const u of FIXTURE_USERS) console.log(`  ${u.role.padEnd(15)} ${u.email}`);
    console.log(`\nSign in at ${env.APP_BASE_URL ?? "http://localhost:3000"}/login (host must be ${host}).`);
    if (!env.DEV_FIXTURE_PASSWORD) console.log("Set DEV_FIXTURE_PASSWORD in .env.local to keep the same password across runs.");
  } finally {
    await sql.end();
  }
}

async function findAuthUser(supa: SupabaseClient, email: string): Promise<string | null> {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 200 });
    if (error) fail(`Supabase listUsers: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
