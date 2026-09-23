// Runs the 26 self-checking schema tests as the owner inside ONE transaction that is rolled back,
// so they can run against any database that has the DDL applied (dev or CI) without leaving data.
// Exit code != 0 on any failure (ON_ERROR_STOP). Expected last line: "ALL 26 SCHEMA CHECKS PASSED".
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadEnv } from "./env.mjs";
import { runPsql } from "./psql.mjs";

const env = loadEnv();
const url = process.argv.includes("--url") ? process.argv[process.argv.indexOf("--url") + 1] : env.OWNER_DATABASE_URL;
const tests = fs.readFileSync(path.join(ROOT, "db", "tests", "ecofy_schema_tests_v1.4.sql"), "utf8");
// The handoff file assumes autocommit: `SET LOCAL ROLE ecofy_app` inside a DO block ends with that
// statement. Inside one wrapping transaction it would persist, so the role is reset after every block
// to keep the original per-statement semantics (the owner bypasses RLS, exactly as in autocommit).
const perStatement = tests.replace(/^END \$\$;[ \t]*$/gm, () => "END $$;\nRESET ROLE;");
const wrapped = `BEGIN;\n${perStatement}\nROLLBACK;\n`;
const tmp = path.join(ROOT, ".data", "tmp-schema-tests.sql");
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, wrapped);
const r = runPsql({ url, args: ["-f", tmp] });
fs.unlinkSync(tmp);
process.exit(r.status ?? 1);
