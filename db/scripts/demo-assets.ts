/**
 * Demo assets — LOCAL / STAGING ONLY. Never run against production.
 *
 * Creates, idempotently, for the tenant on TENANT_HOSTS[0], N demo customers + cases already at S8
 * (disbursed) with an `assets` row each, an EMI history and one lifecycle event on a couple of them,
 * so Ecofy › Assets and the CRM's Sales Head › Ecofy › Assets have something to show.
 *
 * Marker: cases.ecofy_lead_id = 'DEMO-ASSET-<n>' and customers.mobile_e164 = '+9199990001<nn>'.
 * Re-running skips rows that already exist. `--remove` deletes exactly those rows again.
 *
 * Usage:  npx tsx db/scripts/demo-assets.ts [--count 6] [--remove] [--i-know-this-is-staging]
 * Needs:  OWNER_DATABASE_URL (bypasses RLS) and TENANT_HOSTS in .env.local or .env
 */
import dotenv from "dotenv";
import path from "node:path";
import postgres from "postgres";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const env = process.env;
const argv = process.argv.slice(2);
const flag = (f: string) => argv.includes(f);
const arg = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (env.NODE_ENV === "production") fail("Refusing to run demo assets with NODE_ENV=production");
const host = (env.TENANT_HOSTS ?? "localhost:3000").split(",")[0].trim().toLowerCase();
if (/itarang\.com$/.test(host) && !flag("--i-know-this-is-staging")) {
  fail(`TENANT_HOSTS[0] is ${host}; pass --i-know-this-is-staging to seed demo assets on a hosted environment`);
}
if (/^ecofy\.itarang\.com$/.test(host)) fail("Refusing: TENANT_HOSTS[0] is the production host");
const ownerUrl = env.OWNER_DATABASE_URL ?? fail("OWNER_DATABASE_URL is required");
const count = Math.min(Math.max(Number(arg("--count") ?? 6), 1), 40);

type Demo = {
  n: number;
  fullName: string;
  city: string;
  state: string;
  pincode: string;
  address: string;
  propertyType: string;
  segment: "RESI" | "ESS" | "CI";
  system: string;
  totalInr: number;
  commissionedDaysAgo: number;
  status: "ACTIVE" | "BUYBACK" | "REDEPLOYED" | "CLOSED";
  emi: Array<["CURRENT" | "DPD_1_30" | "DPD_31_60" | "DPD_61_90" | "DPD_90_PLUS" | "CLOSED", number]>; // [state, days ago]
  event?: { type: "BUYBACK" | "REDEPLOYED" | "CLOSED"; daysAgo: number; note: string };
};

const DEMOS: Demo[] = [
  { n: 1, fullName: "Suresh Pawar", city: "Nashik", state: "MH", pincode: "422001", address: "12, Gangapur Road, Nashik", propertyType: "HOUSE", segment: "RESI", system: "3 kWp solar + 5 kWh battery", totalInr: 262000, commissionedDaysAgo: 120, status: "ACTIVE", emi: [["CURRENT", 90], ["CURRENT", 60], ["CURRENT", 30]] },
  { n: 2, fullName: "Meena Kulkarni", city: "Pune", state: "MH", pincode: "411038", address: "Flat 4, Kothrud, Pune", propertyType: "FLAT", segment: "RESI", system: "2 kWp solar + 3 kWh battery", totalInr: 188000, commissionedDaysAgo: 95, status: "ACTIVE", emi: [["CURRENT", 60], ["DPD_1_30", 30], ["CURRENT", 5]] },
  { n: 3, fullName: "Rahul Deshmukh", city: "Nagpur", state: "MH", pincode: "440010", address: "Plot 9, Dharampeth, Nagpur", propertyType: "HOUSE", segment: "RESI", system: "5 kWp solar + 10 kWh battery", totalInr: 471000, commissionedDaysAgo: 200, status: "ACTIVE", emi: [["CURRENT", 150], ["DPD_1_30", 120], ["DPD_31_60", 90], ["DPD_61_90", 60], ["DPD_90_PLUS", 30]] },
  { n: 4, fullName: "Anita Shinde", city: "Aurangabad", state: "MH", pincode: "431001", address: "Shop 2, CIDCO, Aurangabad", propertyType: "RENTED_SHOP", segment: "CI", system: "5 kWh storage, 5 kVA", totalInr: 158000, commissionedDaysAgo: 260, status: "BUYBACK", emi: [["CURRENT", 230], ["CURRENT", 200], ["DPD_1_30", 170], ["DPD_31_60", 140], ["CLOSED", 40]], event: { type: "BUYBACK", daysAgo: 40, note: "Customer relocated; battery bought back at 62% SOH" } },
  { n: 5, fullName: "Vikram Patil", city: "Kolhapur", state: "MH", pincode: "416001", address: "Rajarampuri, Kolhapur", propertyType: "HOUSE", segment: "RESI", system: "3 kWp solar only", totalInr: 165000, commissionedDaysAgo: 310, status: "REDEPLOYED", emi: [["CURRENT", 280], ["CURRENT", 250], ["CURRENT", 220], ["CLOSED", 70]], event: { type: "REDEPLOYED", daysAgo: 70, note: "Redeployed to a new customer in Sangli" } },
  { n: 6, fullName: "Priya Joshi", city: "Nashik", state: "MH", pincode: "422005", address: "Indira Nagar, Nashik", propertyType: "HOUSE", segment: "RESI", system: "3 kWp solar + 5 kWh battery", totalInr: 259000, commissionedDaysAgo: 15, status: "ACTIVE", emi: [] },
  { n: 7, fullName: "Ganesh More", city: "Solapur", state: "MH", pincode: "413001", address: "Hotgi Road, Solapur", propertyType: "HOUSE", segment: "RESI", system: "2 kWp solar + 3 kWh battery", totalInr: 182000, commissionedDaysAgo: 45, status: "ACTIVE", emi: [["CURRENT", 15]] },
  { n: 8, fullName: "Sunita Bhosale", city: "Satara", state: "MH", pincode: "415001", address: "Sadar Bazar, Satara", propertyType: "FLAT", segment: "RESI", system: "5 kWh storage, 5 kVA", totalInr: 152000, commissionedDaysAgo: 400, status: "CLOSED", emi: [["CURRENT", 370], ["CURRENT", 340], ["CURRENT", 310], ["CLOSED", 20]], event: { type: "CLOSED", daysAgo: 20, note: "Loan foreclosed by the customer" } },
];

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const marker = (n: number) => `DEMO-ASSET-${n}`;
const mobile = (n: number) => `+919999000${String(100 + n).slice(-3)}`;

async function main() {
  const sql = postgres(ownerUrl, { ssl: /localhost|127\.0\.0\.1/.test(ownerUrl) ? undefined : "require", prepare: false, max: 2, onnotice: () => {} });
  try {
    const tenant = (await sql<{ id: string; code: string }[]>`select t.id, t.code from tenants t join tenant_domains d on d.tenant_id = t.id where d.host = ${host} limit 1`)[0];
    if (!tenant) fail(`No tenant for host ${host}; run npm run db:seed first`);
    console.log(`Tenant ${tenant.code} (${host})`);

    if (flag("--remove")) {
      const removed = await sql.begin(async (tx) => {
        const cases = await tx<{ id: string; customer_id: string }[]>`select id, customer_id from cases where tenant_id = ${tenant.id} and ecofy_lead_id like 'DEMO-ASSET-%'`;
        if (!cases.length) return 0;
        const caseIds = cases.map((c) => c.id);
        const assets = await tx<{ id: string }[]>`select id from assets where case_id = any(${caseIds}::uuid[])`;
        const assetIds = assets.map((a) => a.id);
        if (assetIds.length) {
          await tx`delete from asset_events where asset_id = any(${assetIds}::uuid[])`;
          await tx`delete from emi_status_updates where asset_id = any(${assetIds}::uuid[])`;
          await tx`delete from assets where id = any(${assetIds}::uuid[])`;
        }
        await tx`delete from audit_log where case_id = any(${caseIds}::uuid[])`.catch(() => undefined);
        await tx`delete from cases where id = any(${caseIds}::uuid[])`;
        const custIds = cases.map((c) => c.customer_id);
        await tx`delete from customers where id = any(${custIds}::uuid[]) and mobile_e164 like '+919999000%' and not exists (select 1 from cases c where c.customer_id = customers.id)`;
        return cases.length;
      });
      console.log(`Removed ${removed} demo asset case(s).`);
      return;
    }

    const orgs = await sql<{ id: string; kind: string }[]>`select id, kind from orgs where tenant_id = ${tenant.id}`;
    const orgId = (kind: string) => orgs.find((o) => o.kind === kind)?.id ?? fail(`Org ${kind} missing`);
    const userOf = async (roles: string[]) =>
      (await sql<{ id: string }[]>`select id from users where tenant_id = ${tenant.id} and status = 'ACTIVE' and role = any(${roles}::user_role[]) order by created_at limit 1`)[0]?.id ??
      fail(`No ACTIVE user with role ${roles.join("/")} — run npm run db:fixtures first`);
    const ecofyUser = await userOf(["ECOFY_USER", "ECOFY_ADMIN"]);
    const ecofyAdmin = await userOf(["ECOFY_ADMIN"]);
    const itarangWorker = await userOf(["ITARANG_CALLER", "ITARANG_ADMIN"]);
    const financier = (await sql<{ id: string }[]>`select id from financiers where tenant_id = ${tenant.id} and active order by is_default desc limit 1`)[0]?.id ?? null;

    let created = 0;
    let skipped = 0;
    for (const d of DEMOS.slice(0, count)) {
      const exists = (await sql<{ id: string }[]>`select id from cases where tenant_id = ${tenant.id} and ecofy_lead_id = ${marker(d.n)} limit 1`)[0];
      if (exists) {
        skipped += 1;
        continue;
      }
      await sql.begin(async (tx) => {
        const createdAt = daysAgo(d.commissionedDaysAgo + 45);
        const customer =
          (await tx<{ id: string }[]>`select id from customers where tenant_id = ${tenant.id} and mobile_e164 = ${mobile(d.n)} limit 1`)[0] ??
          (
            await tx<{ id: string }[]>`insert into customers(tenant_id, full_name, mobile_e164, customer_type, business_name, address, city, state, pincode, preferred_language, property_type, consent_obtained, consent_date, consent_source, created_at)
              values (${tenant.id}, ${d.fullName}, ${mobile(d.n)}, ${d.segment === "CI" ? "BUSINESS" : "INDIVIDUAL"}, ${d.segment === "CI" ? `${d.fullName.split(" ")[0]} Traders` : null}, ${d.address}, ${d.city}, ${d.state}, ${d.pincode}, 'mr', ${d.propertyType}, true, ${isoDate(createdAt)}, 'DEMO_SEED', ${createdAt}) returning id`
          )[0];
        const c = (
          await tx<{ id: string; case_no: string }[]>`insert into cases(tenant_id, customer_id, segment, source, owner_org_id, stage, sub_status, stage_entered_at, temperature, qualified_by, assigned_user_id, queue_entered_at, first_call_at, financier_id, product_interest, avg_monthly_bill_inr, sanctioned_load_kw, existing_backup, preferred_call_time, ecofy_lead_id, version, created_by, created_at, updated_at)
            values (${tenant.id}, ${customer.id}, ${d.segment}, 'ECOFY_MANUAL', ${orgId("ECOFY")}, 'S8', null, ${daysAgo(d.commissionedDaysAgo)}, ${d.n % 2 ? "HOT" : "WARM"}, ${ecofyUser}, ${itarangWorker}, ${daysAgo(d.commissionedDaysAgo + 40)}, ${daysAgo(d.commissionedDaysAgo + 39)}, ${financier}, ${d.system.includes("solar only") ? "SOLAR_ONLY" : d.system.includes("storage") ? "STORAGE_ONLY" : "SOLAR_STORAGE"}, ${2500 + d.n * 350}, ${3 + (d.n % 3)}, 'NONE', 'EVENING', ${marker(d.n)}, 12, ${ecofyUser}, ${createdAt}, ${daysAgo(d.commissionedDaysAgo)}) returning id, case_no`
        )[0];
        const asset = (
          await tx<{ id: string }[]>`insert into assets(tenant_id, case_id, system_snapshot, commissioned_on, status, created_at)
            values (${tenant.id}, ${c.id}, ${sql.json({ system: d.system, fileNo: `DEMO-F-${String(d.n).padStart(3, "0")}`, acceptedTotalInr: d.totalInr, quoteVersion: 1, demo: true })}, ${isoDate(daysAgo(d.commissionedDaysAgo))}, ${d.status}, ${daysAgo(d.commissionedDaysAgo)}) returning id`
        )[0];
        for (const [state, ago] of d.emi) {
          await tx`insert into emi_status_updates(tenant_id, asset_id, as_of, state, note, recorded_by, recorded_at)
            values (${tenant.id}, ${asset.id}, ${isoDate(daysAgo(ago))}, ${state}, ${state === "CURRENT" ? null : `Demo: ${state.replace(/_/g, " ").toLowerCase()}`}, ${ecofyAdmin}, ${daysAgo(ago)}) on conflict (asset_id, as_of) do nothing`;
        }
        if (d.event) {
          await tx`insert into asset_events(tenant_id, asset_id, type, on_date, note, recorded_by, recorded_at)
            values (${tenant.id}, ${asset.id}, ${d.event.type}, ${isoDate(daysAgo(d.event.daysAgo))}, ${d.event.note}, ${ecofyAdmin}, ${daysAgo(d.event.daysAgo)})`;
        }
        console.log(`  + ${c.case_no}  ${d.fullName} (${d.city})  ${d.system}  ${d.status}`);
      });
      created += 1;
    }
    console.log(`Done: ${created} created, ${skipped} already present. Remove again with --remove.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
