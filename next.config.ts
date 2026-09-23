import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // PM2 runs `node .next/standalone/server.js` (never `next start`) — BRD §10 known trap.
  output: "standalone",
  // Pin tracing to this project: a stray lockfile in a parent (OneDrive / home) otherwise makes Next
  // walk the whole home folder and exhaust memory.
  outputFileTracingRoot: path.join(__dirname),
  generateBuildId: async () => process.env.GITHUB_SHA?.slice(0, 12) ?? "dev",
  images: { unoptimized: true },
  serverExternalPackages: ["pino", "pino-pretty", "postgres", "bullmq", "ioredis", "exceljs"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
