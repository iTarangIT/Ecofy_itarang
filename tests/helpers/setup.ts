// Vitest setup: load .env.local, force test-friendly drivers and a stub JWT secret.
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.AUTH_JWT_STUB_SECRET ??= "test-stub-secret-test-stub-secret";
process.env.STORAGE_DRIVER = "local";
process.env.MAIL_DRIVER = "dev";
process.env.SMS_DRIVER = "dev";
process.env.OTP_DEV_ECHO = "true";
process.env.QUEUE_DRIVER = "inline";
process.env.LOCAL_STORAGE_DIR = ".data/test-storage";
process.env.DEV_MAIL_DIR = ".data/test-mail";
process.env.DEV_SMS_DIR = ".data/test-sms";
process.env.LOG_LEVEL ??= "warn";
process.env.LOG_PRETTY = "false";
process.env.TENANT_HOSTS = "test.local";
