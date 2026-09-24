/* eslint-disable @typescript-eslint/no-require-imports */
// PM2: ecofy-lms (web) and ecofy-worker (jobs). BRD §10 trap: with output:"standalone" the web process
// MUST run node .next/standalone/server.js (scripts/postbuild.mjs copies .next/static and public into it).
//
// .cjs because package.json has "type": "module" and PM2 requires this file with CommonJS semantics.
// The release's .env (a symlink to /srv/ecofy/shared/.env on servers) is loaded here and handed to both
// processes: the standalone server does not read env files from the project root, and PM2 keeps the
// values across restarts. Deploys recreate both apps (deploy/remote-deploy.sh): a reload keeps the old cwd.
const fs = require("node:fs");
const path = require("node:path");

function fileEnv() {
  for (const name of [".env.local", ".env"]) {
    const file = path.join(__dirname, name);
    if (!fs.existsSync(file)) continue;
    try {
      return require("dotenv").parse(fs.readFileSync(file));
    } catch {
      return {};
    }
  }
  return {};
}

const shared = fileEnv();
const port = shared.PORT || process.env.PORT || 3100;

module.exports = {
  apps: [
    {
      name: "ecofy-lms",
      script: ".next/standalone/server.js",
      cwd: __dirname,
      env: { ...shared, NODE_ENV: "production", PORT: port, HOSTNAME: "127.0.0.1", ECOFY_PROCESS: "ecofy-lms" },
      instances: 1,
      max_memory_restart: "600M",
      time: true,
    },
    {
      name: "ecofy-worker",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/worker/main.ts",
      cwd: __dirname,
      env: { ...shared, NODE_ENV: "production", ECOFY_PROCESS: "ecofy-worker" },
      instances: 1,
      max_memory_restart: "400M",
      time: true,
    },
  ],
};
