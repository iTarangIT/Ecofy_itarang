import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { config } from "@/core/config";

/**
 * The application connects ONLY as `ecofy_app` (RLS enforced). Migrations, seed and
 * schema tests use OWNER_DATABASE_URL through db/scripts, never this module.
 */
type PgClient = ReturnType<typeof postgres>;

declare global {
  var __ecofySql: PgClient | undefined;
}

function create(): PgClient {
  const url = config().DATABASE_URL;
  const local = /localhost|127\.0\.0\.1/.test(url);
  return postgres(url, {
    ssl: local ? undefined : "require",
    prepare: false, // safe with transaction/session poolers
    max: config().isProd ? 10 : 5,
    idle_timeout: 30,
    connect_timeout: 15,
    onnotice: () => {},
  });
}

export const sqlClient: PgClient = globalThis.__ecofySql ?? create();
if (!config().isProd) globalThis.__ecofySql = sqlClient;

export const db = drizzle(sqlClient, { schema });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
