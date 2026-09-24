// Applies the authoritative DDL as the owner, then finishes local role setup:
//   - ALTER ROLE ecofy_app PASSWORD (from .env.local ECOFY_APP_PASSWORD)
//   - GRANT ecofy_app TO <owner>  (lets the owner run `SET ROLE ecofy_app` in the schema tests)
//   - the additive db/schema/0001+ files (db/scripts/migrate.mjs)
// Idempotency: refuses to run when public already has tables unless --force (drops the public schema first).
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadEnv, parsePgUrl } from "./env.mjs";
import { runPsql } from "./psql.mjs";
import { applyMigrations } from "./migrate.mjs";

const env = loadEnv();
const force = process.argv.includes("--force");
const url = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : env.OWNER_DATABASE_URL;
const ddl = path.join(ROOT, "db", "schema", "0000_ecofy_schema_v1.4.sql");

const count = runPsql({ url, args: ["-Atc", "select count(*) from pg_tables where schemaname='public'"], stdio: ["ignore", "pipe", "inherit"] });
const n = Number((count.stdout || "0").trim());
if (n > 0 && !force) {
  console.error(`public schema already has ${n} tables. Re-run with --force to DROP SCHEMA public CASCADE and re-apply.`);
  process.exit(2);
}
if (n > 0 && force) {
  console.log(`Dropping public schema (${n} tables) ...`);
  const d = runPsql({ url, args: ["-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;"] });
  if (d.status !== 0) process.exit(d.status);
}

console.log("Applying", path.relative(ROOT, ddl));
const r = runPsql({ url, args: ["-1", "-f", ddl] });
if (r.status !== 0) process.exit(r.status);

const owner = parsePgUrl(url).user.split(".")[0];
const pwd = env.ECOFY_APP_PASSWORD;
if (!pwd) { console.error("ECOFY_APP_PASSWORD missing in .env.local (run db:init-env)"); process.exit(1); }
const sql = `ALTER ROLE ecofy_app PASSWORD :'pwd'; GRANT ecofy_app TO :"owner";`;
const tmp = path.join(ROOT, ".data", "tmp-role.sql");
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, sql);
const r2 = runPsql({ url, args: ["-v", `pwd=${pwd}`, "-v", `owner=${owner}`, "-f", tmp] });
fs.unlinkSync(tmp);
if (r2.status !== 0) process.exit(r2.status);
console.log("Schema applied; ecofy_app password set; owner granted membership in ecofy_app.");
applyMigrations(url);
