/**
 * Ensure the iTarang CRM integration user exists and is ACTIVE.
 *
 * Every signed call from the iTarang CRM (docs/ITARANG_CRM_SYNC.md §4/§5) runs as the user named in
 * ITARANG_CRM_ACTOR_EMAIL, which must be an ACTIVE iTarang Admin of the tenant. A user invited through
 * Admin › Users stays INVITED until that person logs in once, and the iTarang Admin seat cap is 1 by
 * default — so a service-only user is created here directly. It never logs in: auth_user_id stays NULL,
 * which the service path (src/core/auth/service.ts) does not need.
 *
 * Safe to re-run. Reports first; changes nothing without --apply.
 *
 *   node --import tsx db/scripts/ensure-integration-user.ts --email anirudh@itarang.com --name "Anirudh"
 *   node --import tsx db/scripts/ensure-integration-user.ts --email anirudh@itarang.com --name "Anirudh" --apply
 *
 * Env (.env.local, then .env — the release's .env is a symlink to /srv/ecofy/shared/.env on servers):
 *   DATABASE_URL (ecofy_app; RLS context is set per transaction)  — or OWNER_DATABASE_URL
 *   TENANT_HOSTS (first host names the tenant) — or --host <host>
 */
import dotenv from "dotenv";
import path from "node:path";
import postgres from "postgres";

for (const name of [".env.local", ".env"]) dotenv.config({ path: path.resolve(process.cwd(), name) });

const argv = process.argv.slice(2);
const arg = (flag: string) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
};
const apply = argv.includes("--apply");
const email = (arg("--email") ?? process.env.ITARANG_CRM_ACTOR_EMAIL ?? "").trim().toLowerCase();
const fullName = (arg("--name") ?? "iTarang CRM").trim();
const host = (arg("--host") ?? (process.env.TENANT_HOSTS ?? "").split(",")[0] ?? "").trim().toLowerCase();
const url = process.env.OWNER_DATABASE_URL ?? process.env.DATABASE_URL;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}
if (!email || !email.includes("@")) fail("Pass --email <address> (or set ITARANG_CRM_ACTOR_EMAIL)");
if (!host) fail("Pass --host <tenant host> (or set TENANT_HOSTS)");
if (!url) fail("DATABASE_URL (or OWNER_DATABASE_URL) is required");

type UserRow = { id: string; full_name: string; role: string; status: string; auth_user_id: string | null; org_kind: string };
type SeatRow = { seat_limit: number; seats_used: number };

async function main() {
  const sql = postgres(url!, { ssl: /localhost|127\.0\.0\.1/.test(url!) ? undefined : "require", prepare: false, max: 1, onnotice: () => {} });
  try {
    // resolve_tenant() is SECURITY DEFINER: the one lookup allowed before a tenant context exists.
    const tenantId = (await sql<{ id: string | null }[]>`select resolve_tenant(${host}) as id`)[0]?.id;
    if (!tenantId) fail(`No tenant for host ${host}`);

    await sql.begin(async (tx) => {
      // RLS context — same as withSystemContext(): tenant-wide, actor = platform, iTarang Admin scope.
      await tx`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.user_id', '', true), set_config('app.role', 'ITARANG_ADMIN', true)`;

      const org = (await tx<{ id: string }[]>`select id from orgs where tenant_id = ${tenantId} and kind = 'ITARANG'`)[0];
      if (!org) fail("ITARANG org missing for this tenant (run the seed first)");

      const user = (
        await tx<UserRow[]>`select u.id, u.full_name, u.role::text, u.status::text, u.auth_user_id, o.kind::text as org_kind
                            from users u join orgs o on o.id = u.org_id
                            where u.tenant_id = ${tenantId} and u.email = ${email}`
      )[0];
      const seat = (await tx<SeatRow[]>`select seat_limit, seats_used from seat_limits where tenant_id = ${tenantId} and role = 'ITARANG_ADMIN'`)[0];
      const actor = (await tx<{ id: string }[]>`select id from users where tenant_id = ${tenantId} and role = 'ITARANG_ADMIN' order by created_at limit 1`)[0];

      console.log(`Tenant ${tenantId} (${host})`);
      console.log(`ITARANG_ADMIN seats: ${seat ? `${seat.seats_used} / ${seat.seat_limit}` : "no seat_limits row"}`);
      if (user) {
        console.log(`${email}: role ${user.role}, status ${user.status}, org ${user.org_kind}, auth_user_id ${user.auth_user_id ?? "NULL (service-only)"}`);
      } else {
        console.log(`${email}: not found`);
      }

      const ready = user && user.status === "ACTIVE" && user.role === "ITARANG_ADMIN";
      if (ready) {
        console.log("OK — usable as ITARANG_CRM_ACTOR_EMAIL. Nothing to do.");
        return;
      }
      if (user && user.role !== "ITARANG_ADMIN") fail(`Refusing: ${email} exists with role ${user.role}; the integration user must be an iTarang Admin.`);
      if (user && user.status === "DEACTIVATED") fail(`Refusing: ${email} is DEACTIVATED. Reactivate it in Admin › Users, or use another address.`);

      if (!apply) {
        console.log(`Would ${user ? "set status ACTIVE" : "create the user as ITARANG_ADMIN / ACTIVE"}${!user && seat && seat.seats_used >= seat.seat_limit ? ` and raise the ITARANG_ADMIN seat cap ${seat.seat_limit} -> ${seat.seat_limit + 1}` : ""}. Re-run with --apply.`);
        return;
      }

      if (user) {
        // INVITED → ACTIVE without a login (the service path never needs Supabase).
        await tx`update users set status = 'ACTIVE' where id = ${user.id}`;
        console.log(`Activated ${email}.`);
        return;
      }

      if (seat && seat.seats_used >= seat.seat_limit) {
        await tx`insert into seat_ledger(tenant_id, role, action, old_limit, new_limit, actor_id)
                 values (${tenantId}, 'ITARANG_ADMIN', 'LIMIT_CHANGED', ${seat.seat_limit}, ${seat.seat_limit + 1}, ${actor?.id ?? null})`;
        await tx`update seat_limits set seat_limit = ${seat.seat_limit + 1} where tenant_id = ${tenantId} and role = 'ITARANG_ADMIN'`;
        console.log(`Raised ITARANG_ADMIN seat cap ${seat.seat_limit} -> ${seat.seat_limit + 1} (ledgered).`);
      }
      // One conditional UPDATE takes the seat, exactly like m01-access takeSeat().
      const taken = await tx`update seat_limits set seats_used = seats_used + 1
                             where tenant_id = ${tenantId} and role = 'ITARANG_ADMIN' and seats_used < seat_limit returning role`;
      if (taken.length !== 1) fail("Could not take an ITARANG_ADMIN seat (cap still full?)");
      const created = (
        await tx<{ id: string }[]>`insert into users(tenant_id, org_id, full_name, email, role, status, created_by)
                                   values (${tenantId}, ${org.id}, ${fullName}, ${email}, 'ITARANG_ADMIN', 'ACTIVE', ${actor?.id ?? null}) returning id`
      )[0];
      await tx`insert into seat_ledger(tenant_id, role, action, user_id, actor_id) values (${tenantId}, 'ITARANG_ADMIN', 'SEAT_ADDED', ${created.id}, ${actor?.id ?? null})`;
      console.log(`Created ${email} (${fullName}) as ITARANG_ADMIN / ACTIVE, id ${created.id}.`);
    });
    console.log(`Set ITARANG_CRM_ACTOR_EMAIL=${email} on the web + worker env and restart them (pm2 restart ecofy-lms ecofy-worker --update-env).`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
