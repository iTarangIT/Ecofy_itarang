// Runs ecofy_seed_v1.1.sql once, as the owner. Variables: host (tenant host), ia_email, ia_name.
// The checked-in seed is verbatim from the handoff; on Windows psql cannot open /dev/null,
// so a temporary copy rewrites `\g /dev/null` to `\g NUL`.
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mjs";
import { runPsql } from "./psql.mjs";

const env = loadEnv();
const url = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : env.OWNER_DATABASE_URL;
const host = process.env.SEED_HOST || (env.TENANT_HOSTS || "localhost:3000").split(",")[0].trim();
const iaEmail = env.SEED_IA_EMAIL || "ia@ecofy.local";
const iaName = env.SEED_IA_NAME || "iTarang Admin";

const already = runPsql({ url, args: ["-Atc", "select count(*) from tenants where code='ECOFY'"], stdio: ["ignore", "pipe", "inherit"] });
if (Number((already.stdout || "0").trim()) > 0 && !process.argv.includes("--force")) {
  console.log("Seed already applied (tenant ECOFY exists). Nothing to do.");
  process.exit(0);
}

let seed = fs.readFileSync(path.join(ROOT, "db", "seed", "ecofy_seed_v1.1.sql"), "utf8");
if (process.platform === "win32") seed = seed.replace(/\\g \/dev\/null/g, "\\g NUL");
const tmp = path.join(ROOT, ".data", "tmp-seed.sql");
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, seed);
console.log(`Seeding tenant host=${host} ia_email=${iaEmail}`);
const r = runPsql({ url, args: ["-v", `host=${host}`, "-v", `ia_email=${iaEmail}`, "-v", `ia_name=${iaName}`, "-f", tmp] });
fs.unlinkSync(tmp);
process.exit(r.status ?? 1);
