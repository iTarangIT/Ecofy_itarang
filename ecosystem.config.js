// PM2: ecofy-lms (web) and ecofy-worker (jobs). BRD §10 trap: with output:"standalone" the web process
// MUST run node .next/standalone/server.js (scripts/postbuild.mjs copies .next/static and public into it).
module.exports = {
  apps: [
    {
      name: "ecofy-lms",
      script: ".next/standalone/server.js",
      cwd: __dirname,
      env: { NODE_ENV: "production", PORT: process.env.PORT || 3100, HOSTNAME: "127.0.0.1", ECOFY_PROCESS: "ecofy-lms" },
      instances: 1,
      max_memory_restart: "600M",
      time: true,
    },
    {
      name: "ecofy-worker",
      script: "node_modules/tsx/dist/cli.mjs",
      args: "src/worker/main.ts",
      cwd: __dirname,
      env: { NODE_ENV: "production", ECOFY_PROCESS: "ecofy-worker" },
      instances: 1,
      max_memory_restart: "400M",
      time: true,
    },
  ],
};
