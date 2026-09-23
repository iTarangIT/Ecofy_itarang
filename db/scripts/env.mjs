// Shared helpers for the db scripts. Node built-ins only (runs before npm install).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Files + process.env (process.env wins). */
export function loadEnv(files = [".env", ".env.local"]) {
  return { ...loadEnvFiles(files), ...process.env };
}

/** Minimal .env parser (KEY=VALUE, # comments, optional quotes). Later files win. Files only. */
export function loadEnvFiles(files = [".env", ".env.local"]) {
  const out = {};
  for (const f of files) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      else val = val.replace(/\s+#.*$/, "");
      out[key] = val;
    }
  }
  return out;
}

/**
 * Parse a postgresql:// URL tolerating an un-encoded '@' or ':' inside the password
 * (the host is everything after the LAST '@').
 */
export function parsePgUrl(url) {
  const m = /^postgres(?:ql)?:\/\/(.*)@([^@/]+?)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/.exec(url.trim());
  if (!m) throw new Error("Not a postgresql:// URL");
  const [, userinfo, host, port, database, query] = m;
  const i = userinfo.indexOf(":");
  const user = decodeURIComponentSafe(i < 0 ? userinfo : userinfo.slice(0, i));
  const password = i < 0 ? "" : decodeURIComponentSafe(userinfo.slice(i + 1));
  return { user, password, host, port: port ? Number(port) : 5432, database, query: query ?? "" };
}

function decodeURIComponentSafe(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function buildPgUrl({ user, password, host, port, database, query }) {
  const q = query ? `?${query}` : "";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}${q}`;
}

/** Environment variables for psql/libpq so the URL never has to be re-parsed. */
export function pgEnvFor(url) {
  const c = parsePgUrl(url);
  return {
    PGHOST: c.host,
    PGPORT: String(c.port),
    PGUSER: c.user,
    PGPASSWORD: c.password,
    PGDATABASE: c.database,
    PGSSLMODE: /localhost|127\.0\.0\.1/.test(c.host) ? "prefer" : "require",
  };
}

export function psqlBinary(env) {
  const candidates = [
    env.PSQL,
    "C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe",
    "C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe",
    "C:\\Program Files\\PostgreSQL\\15\\bin\\psql.exe",
    "psql",
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === "psql") return c;
    if (fs.existsSync(c)) return c;
  }
  return "psql";
}
