// Must be the FIRST import of the worker entry: ES module imports are hoisted, so the database client
// would otherwise read config() before any env file is loaded. Same precedence as Next.js:
// .env.local overrides .env (the bare owner URL line some setups keep in .env is ignored by dotenv).
import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });
process.env.ECOFY_PROCESS = "ecofy-worker";
