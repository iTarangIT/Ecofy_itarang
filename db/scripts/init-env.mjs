// Creates/updates .env.local from a bare `postgresql://...` line found in .env (or OWNER_DATABASE_URL).
// - normalises the owner URL (percent-encodes the password)
// - generates a password for the ecofy_app role and derives DATABASE_URL for it
// - fills every other key from .env.example when missing
// Nothing is printed except key names.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT, loadEnvFiles, parsePgUrl, buildPgUrl } from "./env.mjs";

const envFile = path.join(ROOT, ".env");
const localFile = path.join(ROOT, ".env.local");
const current = loadEnvFiles([".env.local"]);
const loadEnv = loadEnvFiles;

let ownerUrl = process.env.OWNER_DATABASE_URL || current.OWNER_DATABASE_URL;
if (!ownerUrl && fs.existsSync(envFile)) {
  const bare = fs.readFileSync(envFile, "utf8").split(/\r?\n/).map((l) => l.trim()).find((l) => /^postgres(ql)?:\/\//.test(l));
  if (bare) ownerUrl = bare;
  else {
    const kv = loadEnv([".env"]);
    ownerUrl = kv.OWNER_DATABASE_URL || kv.DATABASE_URL;
  }
}
if (!ownerUrl) {
  console.error("No owner connection string found. Put a postgresql://... line in .env or set OWNER_DATABASE_URL.");
  process.exit(1);
}
const owner = parsePgUrl(ownerUrl);
const ownerNormalised = buildPgUrl(owner);

// ecofy_app login: Supabase pooler expects "<role>.<project-ref>"; plain servers use "<role>".
const refMatch = /^postgres\.([a-z0-9]+)$/.exec(owner.user);
const appUser = refMatch ? `ecofy_app.${refMatch[1]}` : "ecofy_app";
const appPassword = current.ECOFY_APP_PASSWORD || crypto.randomBytes(24).toString("base64url");
const appUrl = buildPgUrl({ ...owner, user: appUser, password: appPassword });

// defaults from .env.example
const example = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
const defaults = {};
for (const raw of example.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const eq = line.indexOf("=");
  if (eq < 0) continue;
  defaults[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/\s+#.*$/, "");
}

const merged = { ...defaults, ...current };
merged.OWNER_DATABASE_URL = ownerNormalised;
merged.DATABASE_URL = appUrl;
merged.ECOFY_APP_PASSWORD = appPassword;
if (!current.LOCAL_SIGNING_SECRET || current.LOCAL_SIGNING_SECRET === defaults.LOCAL_SIGNING_SECRET) merged.LOCAL_SIGNING_SECRET = crypto.randomBytes(32).toString("hex");
if (!current.SMS_WEBHOOK_SECRET || current.SMS_WEBHOOK_SECRET === defaults.SMS_WEBHOOK_SECRET) merged.SMS_WEBHOOK_SECRET = crypto.randomBytes(16).toString("hex");
if (refMatch && (!current.NEXT_PUBLIC_SUPABASE_URL || /<project-ref>/.test(current.NEXT_PUBLIC_SUPABASE_URL))) merged.NEXT_PUBLIC_SUPABASE_URL = `https://${refMatch[1]}.supabase.co`;

const order = Object.keys(defaults).concat(Object.keys(merged).filter((k) => !(k in defaults)));
const body = order.map((k) => `${k}=${merged[k] ?? ""}`).join("\n") + "\n";
fs.writeFileSync(localFile, body, "utf8");
console.log(`.env.local written with keys: ${order.join(", ")}`);
console.log(`app role login user: ${appUser}`);
