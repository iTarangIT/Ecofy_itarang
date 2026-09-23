import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// Used ONLY for `drizzle-kit pull` (introspection → src/core/db/schema.ts for query typing).
// The authoritative DDL is db/schema/0000_ecofy_schema_v1.4.sql. Never run `generate` or `push`.
const url = process.env.OWNER_DATABASE_URL;
if (!url) throw new Error("OWNER_DATABASE_URL is not set");

export default defineConfig({
  schema: "./src/core/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url, ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false } },
  schemaFilter: ["public"],
  tablesFilter: ["!pg_stat_*"],
  strict: true,
});
