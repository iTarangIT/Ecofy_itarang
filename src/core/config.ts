import { z } from "zod";

/**
 * Typed process configuration. Read once; every module imports `config` instead of process.env.
 * Secrets never leave this module through logs.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  TENANT_HOSTS: z.string().default("localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL (ecofy_app role) is required"),
  OWNER_DATABASE_URL: z.string().optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  /** Test-only: a JWKS JSON or "stub" to accept locally signed tokens. */
  AUTH_JWT_STUB_SECRET: z.string().optional(),

  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  MAIL_DRIVER: z.enum(["dev", "ses"]).default("dev"),
  SMS_DRIVER: z.enum(["dev", "gupshup"]).default("dev"),
  QUEUE_DRIVER: z.enum(["inline", "bullmq"]).default("inline"),

  LOCAL_STORAGE_DIR: z.string().default(".data/storage"),
  LOCAL_SIGNING_SECRET: z.string().default("dev-only-signing-secret"),
  DEV_MAIL_DIR: z.string().default(".data/mail"),
  DEV_SMS_DIR: z.string().default(".data/sms"),

  AWS_REGION: z.string().default("ap-south-1"),
  S3_BUCKET: z.string().optional(),
  S3_PREFIX: z.string().default("ecofy/"),
  SES_FROM: z.string().default("no-reply@itarang.com"),

  GUPSHUP_API_KEY: z.string().optional(),
  GUPSHUP_APP_NAME: z.string().optional(),
  GUPSHUP_SOURCE: z.string().optional(),
  SMS_WEBHOOK_SECRET: z.string().default("change-me"),

  REDIS_URL: z.string().optional(),

  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  SESSION_COOKIE_NAME: z.string().default("sb-access-token"),
  REFRESH_COOKIE_NAME: z.string().default("sb-refresh-token"),
  DEVICE_COOKIE_NAME: z.string().default("ecofy_device"),

  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof schema> & {
  tenantHosts: string[];
  cookieSecure: boolean;
  isProd: boolean;
  isTest: boolean;
};

let cached: Config | undefined;

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  const c = parsed.data;
  cached = {
    ...c,
    tenantHosts: c.TENANT_HOSTS.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
    cookieSecure: c.COOKIE_SECURE === "true" || c.NODE_ENV === "production",
    isProd: c.NODE_ENV === "production",
    isTest: c.NODE_ENV === "test",
  };
  return cached;
}

/** Test helper: drop the cache so a test can mutate process.env. */
export function resetConfigCache() {
  cached = undefined;
}
