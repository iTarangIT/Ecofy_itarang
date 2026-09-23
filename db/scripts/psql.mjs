// psql wrapper: `node db/scripts/psql.mjs [--app|--owner] [--url <url>] [-f file] [-c sql] [-1] [-v name=value ...]`
// Credentials are passed through libpq environment variables, never on the command line.
import { spawnSync } from "node:child_process";
import { loadEnv, pgEnvFor, psqlBinary } from "./env.mjs";

export function runPsql({ url, args = [], env: extra = {}, stdio = "inherit", input } = {}) {
  const env = loadEnv();
  const target = url ?? env.OWNER_DATABASE_URL;
  if (!target) throw new Error("OWNER_DATABASE_URL (or --url) is not set. Run `npm run db:init-env` first.");
  const bin = psqlBinary(env);
  const r = spawnSync(bin, ["-X", "-v", "ON_ERROR_STOP=1", ...args], {
    env: { ...process.env, ...pgEnvFor(target), ...extra },
    stdio,
    input,
    encoding: "utf8",
  });
  if (r.error) throw r.error;
  return r;
}

import path from "node:path";
const isMain = process.argv[1] && path.basename(process.argv[1]) === "psql.mjs";
if (isMain) {
  const env = loadEnv();
  const argv = process.argv.slice(2);
  let url;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--app") url = env.DATABASE_URL;
    else if (argv[i] === "--owner") url = env.OWNER_DATABASE_URL;
    else if (argv[i] === "--url") url = argv[++i];
    else rest.push(argv[i]);
  }
  const r = runPsql({ url, args: rest });
  process.exit(r.status ?? 1);
}
