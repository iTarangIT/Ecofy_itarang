# CLAUDE.md — Ecofy Lead Workspace

Multi-tenant CRM/LMS for Ecofy × iTarang (tenant #01 on the iTarang Lead Platform). Built from
`Ecofy_Developer_Handoff_v1.4`. The authoritative sources are copied into this repo:

| Question | File |
|---|---|
| What the product does | `docs/BRD_v1.4.txt` (FR-xx ids, state engine §4, jobs §8) |
| API contract | `docs/ecofy_openapi_v1.0.1.yaml` |
| Persistence / RLS | `db/schema/0000_ecofy_schema_v1.4.sql` (**never edit; add new SQL files for changes**) |
| Defaults | `db/seed/ecofy_seed_v1.1.sql` |
| Acceptance | `docs/UAT_v1.1.txt` |
| Where they disagree | `docs/CONFLICTS.md` (add a row; do not invent behaviour) |

## Commands
```bash
npm run dev                 # web + worker (tsx watch)
npm run typecheck           # tsc — use `node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit` if it OOMs
npm run lint
npm run test:unit           # calculator engine, working-hours ageing
npm run test:integration    # API-level UAT flows against the database in .env.local (tenant ITEST, host test.local)
npm run db:init-env         # .env.local from a bare postgresql:// line in .env
npm run db:apply-schema     # owner: applies the DDL, sets ecofy_app password (add --force to drop public first), then db:migrate
npm run db:migrate          # owner: applies pending additive db/schema/0001+ files (tracked in schema_migrations)
npm run db:schema-tests     # the 26 handoff checks, rolled back
npm run db:seed             # ecofy_seed_v1.1 (tenant host = TENANT_HOSTS[0])
npm run db:fixtures         # dev/staging only: Supabase Auth users per role + EPC/financier/systems, publishes release v1
npm run build               # next build (standalone) + postbuild copy; worker runs via tsx (no build step)
```

## Architecture (modular monolith)
- `src/app/api/v1/**/route.ts` — one folder per OpenAPI path; each is `route({ roles, ifMatch?, idempotent?, body?, query? }, handler)`.
- `src/core/http/route.ts` — the request pipeline: tenant from Host (`resolve_tenant`), JWT verify (or a signed iTarang CRM service call acting as an iTarang user, `core/auth/service.ts`), DB session check (one live session), device trust, `x-roles`, one transaction per request with `set_config('app.tenant_id/user_id/role', …, true)` (RLS), If-Match, Idempotency-Key, envelope + error mapping.
- `src/core/state-engine/transition.ts` — the only code that changes `cases.stage`; gates → `GATE_NOT_MET{gate}`; stage history + audit + outbox in the same transaction. `touchCase` bumps `version` for If-Match endpoints; side-entity writes pass `bump: false`.
- `src/modules/mNN-*/service.ts` — one service per BRD module; modules call each other's services, never tables.
- `src/adapters/*` — storage (local | s3), mailer (dev | ses), sms (dev | gupshup), queue (inline | bullmq). Dev drivers write to `.data/`.
- `src/modules/m18-crm-sync/` — iTarang CRM sync (not a BRD module; `docs/ITARANG_CRM_SYNC.md`): outbound deliveries + signed inbound events.
- `src/worker/main.ts` — outbox relay (2 s) + CRM delivery loop (5 s) + cron jobs (croner, IST). Handlers are idempotent; jobs read an injectable clock (`worker/clock.ts`).
- `src/core/db/schema.ts` — `drizzle-kit pull` output, **query typing only**; never run `drizzle-kit generate` or `push`.

## Rules that must not be redesigned (handoff §6)
Assessment required for S3; `PENDING_TECHNICAL_DATA` is never collapsed into `CUSTOM_REQUIRED`; provisional quotes need a reason; overrides are recorded, not blocked; no quote-price override; the File is anchored to `accepted_quote_id` + version and never edited; money only in `*_values` tables readable by the role named on the row; C&I has no calculator; no KYC, no EMI calculation, no money movement; billing off-platform.

## Testing conventions
- Integration tests call the Next route handlers directly (`tests/helpers/api.ts`) with a stub JWT (`AUTH_JWT_STUB_SECRET`) and owner-created sessions; they use tenant `ITEST` on host `test.local` and wipe its business rows per file (`resetTestData`).
- The schema tests must keep printing `ALL 26 SCHEMA CHECKS PASSED`; mutation-check any change to grants, policies or triggers.
- Money leaks are tested by asserting that caller responses never contain amount keys.
