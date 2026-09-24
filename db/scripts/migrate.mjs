// Applies the additive SQL files db/schema/0001_*.sql, 0002_*.sql, ... in name order, as the owner.
// 0000 (the handoff DDL) is applied by apply-schema and never edited. Each file runs in one transaction
// together with its row in `schema_migrations` (owner-only, not visible to ecofy_app), so a file is
// applied exactly once. Usage: `npm run db:migrate [-- --url <owner url>]`.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mjs";
import { runPsql } from "./psql.mjs";

const DIR = path.join(ROOT, "db", "schema");

export function pendingMigrations(url) {
  const init = runPsql({ url, args: ["-qc", "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()); REVOKE ALL ON schema_migrations FROM PUBLIC;"] });
  if (init.status !== 0) process.exit(init.status ?? 1);
  const done = runPsql({ url, args: ["-Atc", "select name from schema_migrations"], stdio: ["ignore", "pipe", "inherit"] });
  if (done.status !== 0) process.exit(done.status ?? 1);
  const applied = new Set((done.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  return fs.readdirSync(DIR).filter((f) => /^\d{4}_[A-Za-z0-9_.-]+\.sql$/.test(f) && !f.startsWith("0000_")).sort().filter((f) => !applied.has(f));
}

export function applyMigrations(url) {
  const files = pendingMigrations(url);
  if (!files.length) console.log("No pending migrations.");
  for (const f of files) {
    console.log("Applying", path.join("db", "schema", f));
    const r = runPsql({ url, args: ["-1", "-f", path.join(DIR, f), "-c", `INSERT INTO schema_migrations(name) VALUES ('${f}')`] });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  return files;
}

const isMain = process.argv[1] && path.basename(process.argv[1]) === "migrate.mjs";
if (isMain) {
  const env = loadEnv();
  const url = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : env.OWNER_DATABASE_URL;
  applyMigrations(url);
}
