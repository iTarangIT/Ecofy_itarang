# Ecofy Lead Workspace

CRM / LMS for Ecofy × iTarang — tenant #01 on the iTarang Lead Platform. Built from **Developer Handoff v1.4**
(BRD v1.4, OpenAPI v1.0.1, schema v1.4, seed v1.1, UAT v1.1). Case flow **S0 → S8**; the platform records
states and enforces gates with evidence — it never does KYC, underwriting, EMI calculation or money movement.

## Stack
Next.js 16 (App Router, standalone) · React 19 · Tailwind 4 · Drizzle + postgres.js · PostgreSQL 15+ with RLS ·
Supabase Auth (email + password, new-device email code, one live session) · BullMQ/Redis or an inline queue ·
S3 or local files · SES or dev mail · Gupshup or dev SMS · PM2 (`ecofy-lms`, `ecofy-worker`).

## Setup (development)
1. `npm install --legacy-peer-deps`
2. Put an owner connection string in `.env` (one bare line `postgresql://user:password@host:5432/db`) and run `npm run db:init-env`
   → writes `.env.local` with `OWNER_DATABASE_URL`, an `ecofy_app` password and dev defaults. Fill `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
3. `npm run db:apply-schema` (applies `db/schema/0000_ecofy_schema_v1.4.sql`, sets the `ecofy_app` password) ·
   `npm run db:schema-tests` (expects `ALL 26 SCHEMA CHECKS PASSED`) · `npm run db:seed` (tenant host = first `TENANT_HOSTS`).
4. `npm run db:fixtures` (dev/staging only) → creates confirmed Supabase Auth users for one user per role
   (`ia@`, `ic@`, `ea@`, `eu1@`, `eu2@` on the `SEED_IA_EMAIL` domain), links them to platform users, adds an EPC partner,
   a second financier and standard systems, and publishes Calculator Release v1. It prints the logins; set
   `DEV_FIXTURE_PASSWORD` to keep the password stable. Without fixtures: create the bootstrap iTarang Admin in Supabase Auth
   with the seed email — the platform links the Supabase user on first login — and invite the rest from **Users & seats**.
5. `npm run dev` → http://localhost:3000. Dev adapters write emails, SMS (with OTPs) and files under `.data/`.

Env keys are documented in `.env.example`. Secrets never go into `.env.example` or git.

## Commands
| Command | What |
|---|---|
| `npm run dev` / `dev:web` / `dev:worker` | Web + worker with tsx watch |
| `npm run typecheck` · `npm run lint` | Static checks |
| `npm run test:unit` · `npm run test:integration` · `npm test` | Vitest; integration tests hit the database in `.env.local` (tenant `ITEST`) |
| `npm run db:*` | init-env, apply-schema (`--force` drops public), schema-tests, seed, fixtures, psql wrapper |
| `npm run build` → `npm start` / `start:worker` | Standalone web build (+ asset copy); the worker runs from source through `tsx` |

## Layout
```
db/            authoritative DDL, seed, schema tests, node scripts (owner role only)
docs/          BRD, baseline, UAT, OpenAPI, CONFLICTS.md (decision register)
src/core       request pipeline, auth, db + RLS context, state engine, audit, outbox, settings, calendar
src/modules    m01…m18 services (one per BRD module)
src/adapters   storage | mailer | sms | queue drivers
src/worker     outbox relay + cron jobs (IST)
src/app        pages and /api/v1 route handlers (thin)
tests/         unit (engine, ageing) and integration (UAT flows)
```

## UAT traceability (P0 unless noted)
| UAT | Where verified |
|---|---|
| 01 import happy path · 02 dedupe · 03 re-upload after File | `m03-intake` service; r3 test "UAT-03"; import wizard UI |
| 04 Hot → queue · 05 Warm push · 06 return (P1) · 07 ageing (P1) | r1 tests; `tests/unit/workingHours.test.ts` |
| 08 meeting gate · 09 appointment rules (P1) | r1 tests |
| 10 worked example · 11 pending vs custom · 12 custom (P1) · 13 types (P1) · 14 C&I · 15 override (P1) | `tests/unit/calculator.engine.test.ts`; r2 tests |
| 16 release approval | r2 test "UAT-16" |
| 17 eligibility first · 18 caller never sees the limit · 19 provisional · 20 versions (P1) | r2 tests |
| 21 OTP limits · 22 File creation | r2 tests + schema tests T25/T26 |
| 23 lower sanction · 24 rejection/routing · 25/26 installation · 27 payout & asset · 28 withdrawal · 29 asset (P1) | r3 tests |
| 30 KYC never enters | r1 test + schema test T16 |
| 31 retention purge (P1) | r3 test "UAT-31" (clock injected) |
| 32 login/device/single session | `m01-access` service; manual check with Supabase |
| 33 seats (P1) · 34 scope · 35 no money outside EA views | r1 / r3 tests |

## Deployment notes
- Build with `output: "standalone"`; PM2 runs `node .next/standalone/server.js` (never `next start`) and the worker as
  `tsx src/worker/main.ts` — see `ecosystem.config.js`. `tsx` is a runtime dependency of the worker process, so install with dev dependencies.
- Set `STORAGE_DRIVER=s3` (bucket CORS must allow browser `PUT` from the app origin), `MAIL_DRIVER=ses`, `SMS_DRIVER=gupshup`,
  `QUEUE_DRIVER=bullmq` with `REDIS_URL`, `COOKIE_SECURE=true`, `TENANT_HOSTS=ecofy.itarang.com`.
- Secrets from AWS Secrets Manager; the app connects as `ecofy_app` only.
