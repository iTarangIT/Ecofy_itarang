import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const pretty = process.env.NODE_ENV !== "production" && process.env.LOG_PRETTY !== "false";

export const logger = pino({
  level,
  base: { service: process.env.ECOFY_PROCESS ?? "ecofy-lms" },
  redact: { paths: ["*.password", "*.code", "*.token", "*.accessToken", "*.refreshToken", "req.headers.cookie"], censor: "[redacted]" },
  ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" } } } : {}),
});

export type Logger = typeof logger;
