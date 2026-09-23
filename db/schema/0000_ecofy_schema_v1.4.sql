-- =====================================================================
-- ecofydb  ·  Ecofy Lead Workspace (ecofy.itarang.com)  ·  schema v1.4
-- PostgreSQL 16  ·  21-Sep-2026  ·  source of truth for Drizzle schema
-- Rules baked in:
--   * tenant_id on EVERY table (child tables included); RLS enabled on every
--     table (app sets app.tenant_id, app.user_id, app.role with SET LOCAL per
--     request transaction). The host -> tenant lookup goes through
--     resolve_tenant(), the only path that runs before a tenant is known.
--   * migrations and seeds run as the owner role; the app connects as ecofy_app
--   * money / financing values live in *_values tables, readable only by
--     the role named on the row (Ecofy Admin for Ecofy, iTarang Admin for
--     other financiers)
--   * the platform stores no KYC documents, no PAN, no bank data
--   * audit_log is INSERT-only for the app role
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------- enums
CREATE TYPE org_kind        AS ENUM ('ECOFY','ITARANG');
CREATE TYPE user_role       AS ENUM ('ECOFY_ADMIN','ECOFY_USER','ITARANG_ADMIN','ITARANG_CALLER');
CREATE TYPE user_status     AS ENUM ('INVITED','ACTIVE','DEACTIVATED');
CREATE TYPE segment         AS ENUM ('RESI','ESS','CI');
CREATE TYPE case_stage      AS ENUM ('S0','S1','S2','S3','S4','S5','S6','S7','S8','CLOSED');
CREATE TYPE temperature     AS ENUM ('COLD','WARM','HOT','NOT_INTERESTED');
CREATE TYPE case_source     AS ENUM ('ECOFY_UPLOAD','ECOFY_MANUAL','CALCULATOR','ITARANG_SOURCED');
CREATE TYPE customer_type   AS ENUM ('INDIVIDUAL','BUSINESS');
CREATE TYPE activity_type   AS ENUM ('CALL','REMARK','COMMENT','FOLLOW_UP','SYSTEM');
CREATE TYPE call_outcome    AS ENUM ('CONNECTED','NO_ANSWER','BUSY','SWITCHED_OFF','WRONG_NUMBER','CALL_BACK');
CREATE TYPE appt_status     AS ENUM ('SCHEDULED','COMPLETED','NO_SHOW','CANCELLED','RESCHEDULED');
CREATE TYPE import_status   AS ENUM ('UPLOADED','MAPPED','VALIDATED','COMMITTING','COMMITTED','FAILED');
CREATE TYPE row_result      AS ENUM ('CREATED','DUPLICATE','REOPENED','REJECTED');
CREATE TYPE release_status  AS ENUM ('DRAFT','PENDING_APPROVAL','PUBLISHED','REJECTED','RETIRED');
CREATE TYPE assess_method   AS ENUM ('CALCULATOR','MANUAL','EPC');
CREATE TYPE reco_status     AS ENUM ('RECOMMENDED','CUSTOM_REQUIRED','PENDING_TECHNICAL_DATA');
CREATE TYPE device_status   AS ENUM ('PENDING','TRUSTED','REVOKED');
CREATE TYPE elig_status     AS ENUM ('REQUESTED','ELIGIBLE','NOT_ELIGIBLE','INFO_NEEDED');
CREATE TYPE quote_status    AS ENUM ('ACTIVE','SUPERSEDED','EXPIRED','ACCEPTED');
CREATE TYPE offer_status    AS ENUM ('DRAFT','SENT','ACCEPTED','SUPERSEDED','EXPIRED');
CREATE TYPE otp_purpose     AS ENUM ('ACCEPTANCE','REACCEPTANCE');
CREATE TYPE otp_status      AS ENUM ('SENT','VERIFIED','EXPIRED','LOCKED','FAILED');
CREATE TYPE fin_status      AS ENUM ('SUBMITTED','SANCTIONED','REJECTED','CANCELLED');
CREATE TYPE install_status  AS ENUM ('NOT_STARTED','SCHEDULED','IN_PROGRESS','INSTALLED','COMMISSIONED','STOPPED');
CREATE TYPE asset_status    AS ENUM ('ACTIVE','BUYBACK','REDEPLOYED','CLOSED');
CREATE TYPE emi_state       AS ENUM ('CURRENT','DPD_1_30','DPD_31_60','DPD_61_90','DPD_90_PLUS','CLOSED');
CREATE TYPE withdraw_status AS ENUM ('REQUESTED','CONFIRMED','REJECTED');

-- ============================================================ A. TENANCY + ACCESS
CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                  -- 'ECOFY'
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','READ_ONLY','EXITED')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_domains (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  host        citext NOT NULL UNIQUE,                -- 'ecofy.itarang.com'
  is_primary  boolean NOT NULL DEFAULT true
);

CREATE TABLE orgs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  kind        org_kind NOT NULL,
  name        text NOT NULL,
  UNIQUE (tenant_id, kind)
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  auth_user_id   uuid UNIQUE,                        -- Supabase Auth user id
  full_name      text NOT NULL,
  email          citext NOT NULL,
  mobile_e164    text,
  role           user_role NOT NULL,
  status         user_status NOT NULL DEFAULT 'INVITED',
  last_login_at  timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  UNIQUE (tenant_id, email)
);

-- seat caps: enforced with ONE conditional UPDATE, never SELECT-then-UPDATE
CREATE TABLE seat_limits (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  role        user_role NOT NULL,
  seat_limit  int NOT NULL CHECK (seat_limit >= 0),
  seats_used  int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, role),
  CHECK (seats_used >= 0 AND seats_used <= seat_limit)
);

CREATE TABLE seat_ledger (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  role        user_role NOT NULL,
  action      text NOT NULL CHECK (action IN ('SEAT_ADDED','SEAT_RELEASED','LIMIT_CHANGED')),
  user_id     uuid REFERENCES users(id),
  old_limit   int,
  new_limit   int,
  actor_id    uuid NOT NULL REFERENCES users(id),
  at          timestamptz NOT NULL DEFAULT now()
);

-- one live session per seat (new login revokes the old one)
CREATE TABLE user_sessions (
  user_id     uuid PRIMARY KEY REFERENCES users(id),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  session_id  text NOT NULL,                         -- Supabase session_id claim; middleware compares every request
  device      text,
  ip          inet,
  started_at  timestamptz NOT NULL DEFAULT now()
);

-- new-device check: a device is a random httpOnly cookie; only its SHA-256 is stored
CREATE TABLE trusted_devices (
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  device_hash      char(64) NOT NULL,
  status           device_status NOT NULL DEFAULT 'PENDING',
  code_hash        text,                             -- email OTP, hashed; cleared once trusted
  code_expires_at  timestamptz,
  attempts         smallint NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  locked_until     timestamptz,
  trusted_until    timestamptz,
  user_agent       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz,
  PRIMARY KEY (user_id, device_hash),
  CHECK (status <> 'TRUSTED' OR trusted_until IS NOT NULL)
);

-- ============================================================ B. SETTINGS + MASTERS
CREATE TABLE settings (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  key         text NOT NULL,                         -- e.g. gate.meeting_before_assessment
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE list_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  list_code   text NOT NULL,     -- return_reason | closure_reason | meeting_type | document_type | language | consent_source | property_type | product_interest | existing_backup | call_time
  code        text NOT NULL,
  label       text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, list_code, code),
  -- KYC-type documents can never become an uploadable type (agreed rule 10)
  CHECK (list_code <> 'document_type' OR upper(code || ' ' || label) !~ '(^|[^A-Z])(PAN|AADHAAR|AADHAR|KYC|BANK|PASSPORT|VOTER|ITR|SALARY|CIBIL)([^A-Z]|$)')
);

CREATE TABLE working_hours (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- ISO: 1 = Monday
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  PRIMARY KEY (tenant_id, weekday),
  CHECK (end_time > start_time)
);

CREATE TABLE holidays (
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  day         date NOT NULL,
  name        text NOT NULL,
  PRIMARY KEY (tenant_id, day)
);

CREATE TABLE epc_partners (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  name          text NOT NULL,
  contact_name  text,
  mobile_e164   text,
  email         citext,
  pincodes      text[] NOT NULL DEFAULT '{}',
  segments      segment[] NOT NULL DEFAULT '{}',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE financiers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  name            text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,     -- Ecofy
  values_visible_to user_role NOT NULL,               -- ECOFY_ADMIN for Ecofy; ITARANG_ADMIN for others
  active          boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, name)
);
CREATE UNIQUE INDEX one_default_financier ON financiers (tenant_id) WHERE is_default;

CREATE TABLE column_mappings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  source_name  text NOT NULL,                        -- 'Ecofy CRM export'
  mapping      jsonb NOT NULL,                       -- {"Mobile No": "mobile", ...}
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_name)
);

-- ============================================================ C. LEAD INTAKE
CREATE TABLE import_batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  uploaded_by        uuid NOT NULL REFERENCES users(id),
  file_key           text NOT NULL,                  -- s3://.../ecofy/imports/<id>.xlsx
  file_name          text NOT NULL,
  mapping_id         uuid REFERENCES column_mappings(id),
  status             import_status NOT NULL DEFAULT 'UPLOADED',
  row_count          int NOT NULL DEFAULT 0,
  created_count      int NOT NULL DEFAULT 0,
  duplicate_count    int NOT NULL DEFAULT 0,
  reopened_count     int NOT NULL DEFAULT 0,
  rejected_count     int NOT NULL DEFAULT 0,
  consent_attested   boolean NOT NULL DEFAULT false,
  attestation_text   text,
  attested_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  committed_at       timestamptz,
  file_purged_at     timestamptz,                    -- uploaded file deleted after the retention setting
  CHECK (status <> 'COMMITTED' OR consent_attested)   -- no commit without the consent confirmation
);

CREATE TABLE import_rows (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  batch_id    uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  row_no      int NOT NULL,
  raw         jsonb,                                 -- raw row; set to NULL after the retention setting
  raw_purged_at timestamptz,
  result      row_result,
  errors      jsonb,
  case_id     uuid,
  UNIQUE (batch_id, row_no)
);

-- ============================================================ D. CUSTOMERS + CASES
CREATE TABLE customers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  full_name           text NOT NULL,
  mobile_e164         text NOT NULL,                 -- dedupe key
  alt_mobile_e164     text,
  email               citext,
  customer_type       customer_type NOT NULL,
  business_name       text,
  address             text NOT NULL,
  city                text NOT NULL,
  state               text NOT NULL,
  pincode             char(6) NOT NULL CHECK (pincode ~ '^[1-9][0-9]{5}$'),
  preferred_language  text,
  property_type       text,
  consent_obtained    boolean NOT NULL CHECK (consent_obtained),
  consent_date        date NOT NULL,
  consent_source      text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, mobile_e164),
  CHECK (mobile_e164 ~ '^\+91[6-9][0-9]{9}$'),
  CHECK (customer_type = 'INDIVIDUAL' OR business_name IS NOT NULL)
);

CREATE SEQUENCE case_no_seq START 1001;

CREATE TABLE cases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  case_no               text NOT NULL UNIQUE DEFAULT ('ECF-' || nextval('case_no_seq')),
  customer_id           uuid NOT NULL REFERENCES customers(id),
  segment               segment NOT NULL,
  source                case_source NOT NULL,
  owner_org_id          uuid NOT NULL REFERENCES orgs(id),      -- who owns the lead (C.4)
  stage                 case_stage NOT NULL DEFAULT 'S0',
  sub_status            text,                                    -- e.g. REACCEPTANCE_PENDING
  stage_entered_at      timestamptz NOT NULL DEFAULT now(),
  temperature           temperature,
  qualified_by          uuid REFERENCES users(id),               -- Ecofy User who qualified (returns go here)
  assigned_user_id      uuid REFERENCES users(id),               -- current worker
  queue_entered_at      timestamptz,
  first_call_at         timestamptz,
  financier_id          uuid REFERENCES financiers(id),
  product_interest      text,
  avg_monthly_bill_inr  int CHECK (avg_monthly_bill_inr >= 0),
  sanctioned_load_kw    numeric(8,2),
  existing_backup       text,
  preferred_call_time   text,
  ecofy_lead_id         text,
  import_batch_id       uuid REFERENCES import_batches(id),
  closure_reason        text,
  closure_note          text,
  closed_at             timestamptz,
  reopen_count          int NOT NULL DEFAULT 0,
  previous_case_id      uuid REFERENCES cases(id),                -- set when a case with a File is re-uploaded
  version               int NOT NULL DEFAULT 1,                  -- optimistic lock (If-Match)
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (stage <> 'CLOSED' OR closure_reason IS NOT NULL)
);
CREATE UNIQUE INDEX one_open_case_per_customer ON cases (customer_id) WHERE stage <> 'CLOSED';
CREATE INDEX cases_stage_idx     ON cases (tenant_id, stage, stage_entered_at);
CREATE INDEX cases_assignee_idx  ON cases (tenant_id, assigned_user_id) WHERE stage <> 'CLOSED';

CREATE TABLE case_stage_history (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  case_id     uuid NOT NULL REFERENCES cases(id),
  from_stage  case_stage,
  to_stage    case_stage NOT NULL,
  sub_status  text,
  reason      text,
  actor_id    uuid REFERENCES users(id),                         -- NULL = platform
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX csh_case_idx ON case_stage_history (case_id, at);

CREATE TABLE case_assignments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  case_id      uuid NOT NULL REFERENCES cases(id),
  user_id      uuid NOT NULL REFERENCES users(id),
  assigned_by  uuid NOT NULL REFERENCES users(id),
  reason       text,
  assigned_at  timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz
);
CREATE UNIQUE INDEX one_open_assignment ON case_assignments (case_id) WHERE ended_at IS NULL;

CREATE TABLE case_returns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  case_id       uuid NOT NULL REFERENCES cases(id),
  reason_code   text NOT NULL,
  note          text,
  returned_by   uuid NOT NULL REFERENCES users(id),
  returned_to   uuid REFERENCES users(id),
  at            timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ E. FOLLOW-UP (S2)
CREATE TABLE activities (                            -- append-only
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  case_id            uuid NOT NULL REFERENCES cases(id),
  type               activity_type NOT NULL,
  call_outcome       call_outcome,
  note               text,
  next_follow_up_at  timestamptz,
  actor_id           uuid REFERENCES users(id),
  at                 timestamptz NOT NULL DEFAULT now(),
  CHECK (type <> 'CALL' OR call_outcome IS NOT NULL)
);
CREATE INDEX act_case_idx ON activities (case_id, at);
CREATE INDEX act_followup_idx ON activities (tenant_id, next_follow_up_at) WHERE next_follow_up_at IS NOT NULL;

CREATE TABLE appointments (                          -- meetings and EPC site visits
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  case_id         uuid NOT NULL REFERENCES cases(id),
  meeting_type    text NOT NULL,                     -- list meeting_type; 'EPC_VISIT' for site visits
  scheduled_at    timestamptz NOT NULL,
  status          appt_status NOT NULL DEFAULT 'SCHEDULED',
  booking_remarks text,                              -- why / agenda, at scheduling
  actual_at       timestamptz,                       -- when it really happened
  meeting_remarks text,                              -- what happened, after the meeting
  outcome_reason  text,                              -- required for NO_SHOW / CANCELLED
  epc_partner_id  uuid REFERENCES epc_partners(id),
  epc_feedback    text,
  rescheduled_from uuid REFERENCES appointments(id),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'COMPLETED' OR (actual_at IS NOT NULL AND meeting_remarks IS NOT NULL)),
  CHECK (status NOT IN ('NO_SHOW','CANCELLED') OR outcome_reason IS NOT NULL),
  CHECK (meeting_type <> 'EPC_VISIT' OR epc_partner_id IS NOT NULL)
);
CREATE INDEX appt_case_idx ON appointments (case_id, scheduled_at);

-- ============================================================ F. CALCULATOR + ASSESSMENT (S3)
-- A release = one immutable, versioned calculator: values + appliances + standard systems.
CREATE TABLE calc_releases (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  version          int NOT NULL,
  status           release_status NOT NULL DEFAULT 'DRAFT',
  params           jsonb NOT NULL,                   -- values, segments, input methods, rules, texts
  change_note      text,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  submitted_at     timestamptz,
  decided_by       uuid REFERENCES users(id),        -- Ecofy Admin (C.6)
  decided_at       timestamptz,
  decision_note    text,
  published_at     timestamptz,
  UNIQUE (tenant_id, version)
);
CREATE UNIQUE INDEX one_published_release ON calc_releases (tenant_id) WHERE status = 'PUBLISHED';
CREATE UNIQUE INDEX one_open_draft        ON calc_releases (tenant_id) WHERE status IN ('DRAFT','PENDING_APPROVAL');

CREATE TABLE calc_appliances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  release_id        uuid NOT NULL REFERENCES calc_releases(id) ON DELETE CASCADE,
  name              text NOT NULL,
  default_watts     int NOT NULL CHECK (default_watts > 0),
  is_motor          boolean NOT NULL DEFAULT false,
  start_multiplier  numeric(4,2) NOT NULL DEFAULT 1 CHECK (start_multiplier >= 1),
  sort_order        int NOT NULL DEFAULT 0,
  active            boolean NOT NULL DEFAULT true,
  UNIQUE (release_id, name)
);

CREATE TABLE calc_systems (                          -- standard systems list, snapshotted per release
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   uuid NOT NULL REFERENCES tenants(id),
  release_id                  uuid NOT NULL REFERENCES calc_releases(id) ON DELETE CASCADE,
  system_code                 text NOT NULL,
  system_name                 text NOT NULL,
  for_resi                    boolean NOT NULL,
  for_ess                     boolean NOT NULL,
  for_ci                      boolean NOT NULL,
  system_type                 text NOT NULL CHECK (system_type IN ('SOLAR_STORAGE','STORAGE_ONLY','SOLAR_ONLY')),
  battery_capacity_kwh        numeric(8,2) NOT NULL CHECK (battery_capacity_kwh >= 0),
  usable_capacity_kwh         numeric(8,2) NOT NULL CHECK (usable_capacity_kwh >= 0),
  battery_chemistry           text,
  inverter_kva                numeric(8,2) NOT NULL CHECK (inverter_kva > 0),
  inverter_type               text NOT NULL CHECK (inverter_type IN ('HYBRID','OFF_GRID','ON_GRID')),
  phase                       text NOT NULL CHECK (phase IN ('SINGLE','THREE')),
  solar_kwp                   numeric(8,2) NOT NULL CHECK (solar_kwp >= 0),
  expandable                  boolean,
  max_expansion_kwh           numeric(8,2),
  battery_warranty_years      smallint,
  inverter_warranty_years     smallint,
  equipment_price_min_inr     int NOT NULL CHECK (equipment_price_min_inr > 0),
  equipment_price_max_inr     int NOT NULL,
  installation_price_min_inr  int NOT NULL CHECK (installation_price_min_inr >= 0),
  installation_price_max_inr  int NOT NULL,
  gst_pct                     numeric(5,2) NOT NULL CHECK (gst_pct >= 0),
  price_updated_on            date NOT NULL,
  epc_partners                text,
  active                      boolean NOT NULL DEFAULT true,
  notes                       text,
  UNIQUE (release_id, system_code),
  CHECK (usable_capacity_kwh <= battery_capacity_kwh),
  CHECK (equipment_price_max_inr >= equipment_price_min_inr),
  CHECK (installation_price_max_inr >= installation_price_min_inr)
);

CREATE TABLE assessments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  case_id              uuid NOT NULL REFERENCES cases(id),
  version              int NOT NULL,
  method               assess_method NOT NULL,
  release_id           uuid REFERENCES calc_releases(id),   -- which calculator produced it
  inputs               jsonb NOT NULL,
  outputs              jsonb NOT NULL,                      -- every step's result, for audit
  recommendation_status reco_status NOT NULL,               -- never collapse 'no data yet' into 'custom required'
  recommended_code     text,
  selected_code        text,
  override_reason      text,
  confirmed_by         uuid REFERENCES users(id),           -- iTarang confirmation closes S3
  confirmed_at         timestamptz,
  created_by           uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version),
  CHECK (method <> 'CALCULATOR' OR release_id IS NOT NULL),
  CHECK ((recommendation_status = 'RECOMMENDED') = (recommended_code IS NOT NULL)),
  CHECK (selected_code IS NULL OR recommended_code IS NULL OR selected_code = recommended_code OR override_reason IS NOT NULL)
);

-- ============================================================ G. OFFER (S4)
CREATE TABLE eligibility_checks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  case_id       uuid NOT NULL REFERENCES cases(id),
  financier_id  uuid NOT NULL REFERENCES financiers(id),
  status        elig_status NOT NULL DEFAULT 'REQUESTED',
  reason        text,
  requested_by  uuid NOT NULL REFERENCES users(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  CHECK (status <> 'NOT_ELIGIBLE' OR reason IS NOT NULL)
);
CREATE UNIQUE INDEX one_open_eligibility ON eligibility_checks (case_id, financier_id) WHERE status IN ('REQUESTED','INFO_NEEDED');

CREATE TABLE eligibility_values (                   -- hidden from callers (S4.6)
  eligibility_id      uuid PRIMARY KEY REFERENCES eligibility_checks(id),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  visible_to          user_role NOT NULL,
  max_eligible_inr    int NOT NULL CHECK (max_eligible_inr > 0),
  recorded_by         uuid NOT NULL REFERENCES users(id),
  recorded_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quote_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  case_id         uuid NOT NULL REFERENCES cases(id),
  epc_partner_id  uuid NOT NULL REFERENCES epc_partners(id),
  channel         text NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP','PHONE')),
  status          text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','RECEIVED','DECLINED')),
  requested_by    uuid NOT NULL REFERENCES users(id),
  requested_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE quotes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  case_id              uuid NOT NULL REFERENCES cases(id),
  version              int NOT NULL,
  epc_partner_id       uuid NOT NULL REFERENCES epc_partners(id),
  quote_request_id     uuid REFERENCES quote_requests(id),
  assessment_id        uuid NOT NULL REFERENCES assessments(id),   -- lineage: which sizing this quote answers
  provisional          boolean NOT NULL DEFAULT false,              -- quoted before power / load data (earned rule 3)
  provisional_reason   text,
  document_id          uuid NOT NULL,                        -- EPC PDF, same case (FK below)
  system_desc          text NOT NULL,
  battery_kwh          numeric(8,2),
  inverter_kva         numeric(8,2),
  solar_kwp            numeric(8,2),
  equipment_inr        int NOT NULL CHECK (equipment_inr >= 0),
  installation_inr     int NOT NULL CHECK (installation_inr >= 0),
  gst_inr              int NOT NULL CHECK (gst_inr >= 0),
  total_inr            int GENERATED ALWAYS AS (equipment_inr + installation_inr + gst_inr) STORED,
  valid_until          date NOT NULL,
  notes                text,
  status               quote_status NOT NULL DEFAULT 'ACTIVE',
  uploaded_by          uuid NOT NULL REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, version),
  UNIQUE (id, case_id),
  UNIQUE (id, case_id, version),
  CHECK (NOT provisional OR provisional_reason IS NOT NULL)
);
CREATE UNIQUE INDEX one_active_quote ON quotes (case_id) WHERE status = 'ACTIVE';

CREATE TABLE offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  case_id         uuid NOT NULL REFERENCES cases(id),
  quote_id        uuid NOT NULL,
  version         int NOT NULL,
  within_limit    boolean,                                   -- computed server-side; amount never exposed
  content         jsonb NOT NULL,                            -- frozen snapshot shown to the customer
  status          offer_status NOT NULL DEFAULT 'DRAFT',
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  UNIQUE (case_id, version),
  UNIQUE (id, case_id),
  FOREIGN KEY (quote_id, case_id) REFERENCES quotes(id, case_id)       -- an offer only uses its own case's quote
);
CREATE UNIQUE INDEX one_live_offer ON offers (case_id) WHERE status IN ('DRAFT','SENT');

-- ============================================================ H. ACCEPTANCE + FILE (S5)
CREATE TABLE otp_challenges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  case_id          uuid NOT NULL REFERENCES cases(id),
  offer_id         uuid NOT NULL,
  purpose          otp_purpose NOT NULL,
  mobile_e164      text NOT NULL,
  code_hash        text NOT NULL,                            -- never store the OTP in clear
  status           otp_status NOT NULL DEFAULT 'SENT',
  attempts         smallint NOT NULL DEFAULT 0 CHECK (attempts <= 5),
  sent_at          timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  verified_at      timestamptz,
  provider_msg_id  text,
  triggered_by     uuid NOT NULL REFERENCES users(id),
  idempotency_key  text NOT NULL,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (id, case_id),
  FOREIGN KEY (offer_id, case_id) REFERENCES offers(id, case_id)       -- an OTP only confirms its own case's offer
);
CREATE UNIQUE INDEX one_live_otp ON otp_challenges (offer_id) WHERE status = 'SENT';

CREATE TABLE files (                                 -- anchored to accepted_quote_id, never reversed
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  file_no            text NOT NULL UNIQUE,
  case_id            uuid NOT NULL UNIQUE REFERENCES cases(id),   -- one File per case
  accepted_quote_id  uuid NOT NULL,
  quote_version      int NOT NULL,
  accepted_total_inr int NOT NULL,
  method             text NOT NULL DEFAULT 'SMS_OTP',
  otp_challenge_id   uuid NOT NULL,
  accepted_at        timestamptz NOT NULL,
  UNIQUE (id, case_id),
  -- the billable anchor: same case, same version; total and OTP chain checked by file_lineage_guard
  FOREIGN KEY (accepted_quote_id, case_id, quote_version) REFERENCES quotes(id, case_id, version),
  FOREIGN KEY (otp_challenge_id, case_id) REFERENCES otp_challenges(id, case_id)
);

CREATE TABLE file_acceptances (                      -- initial + every fresh acceptance (S6.2)
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),
  case_id            uuid NOT NULL,
  file_id            uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('INITIAL','REVISED')),
  offer_id           uuid NOT NULL,
  otp_challenge_id   uuid NOT NULL UNIQUE,
  accepted_at        timestamptz NOT NULL,
  FOREIGN KEY (file_id, case_id)          REFERENCES files(id, case_id),
  FOREIGN KEY (offer_id, case_id)         REFERENCES offers(id, case_id),
  FOREIGN KEY (otp_challenge_id, case_id) REFERENCES otp_challenges(id, case_id)
);

-- ============================================================ I. FINANCING (S6)
CREATE TABLE financing_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  case_id          uuid NOT NULL REFERENCES cases(id),
  file_id          uuid NOT NULL,
  financier_id     uuid NOT NULL REFERENCES financiers(id),
  attempt_no       smallint NOT NULL,
  status           fin_status NOT NULL DEFAULT 'SUBMITTED',
  rejection_reason text,
  routed_by        uuid REFERENCES users(id),                -- iTarang Admin when routed to another financier
  recorded_by      uuid REFERENCES users(id),
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  UNIQUE (case_id, attempt_no),
  FOREIGN KEY (file_id, case_id) REFERENCES files(id, case_id),
  CHECK (status <> 'REJECTED' OR rejection_reason IS NOT NULL)
);
CREATE UNIQUE INDEX one_open_financing ON financing_decisions (case_id) WHERE status = 'SUBMITTED';

CREATE TABLE financing_values (                     -- Ecofy Admin only for Ecofy (agreed rule 5)
  decision_id          uuid PRIMARY KEY REFERENCES financing_decisions(id),
  tenant_id            uuid NOT NULL REFERENCES tenants(id),
  visible_to           user_role NOT NULL,
  sanctioned_inr       int CHECK (sanctioned_inr > 0),
  down_payment_inr     int CHECK (down_payment_inr >= 0),
  tenure_months        smallint,
  emi_inr              int,
  lender_file_no       text,
  recorded_by          uuid NOT NULL REFERENCES users(id),
  recorded_at          timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ J. INSTALLATION + DISBURSEMENT (S7)
CREATE TABLE installations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                uuid NOT NULL REFERENCES tenants(id),
  case_id                  uuid NOT NULL UNIQUE REFERENCES cases(id),
  epc_partner_id           uuid NOT NULL REFERENCES epc_partners(id),
  status                   install_status NOT NULL DEFAULT 'NOT_STARTED',
  scheduled_on             date,
  started_on               date,
  completed_on             date,
  started_before_sanction  boolean NOT NULL DEFAULT false,
  stop_reason              text,
  updated_by               uuid REFERENCES users(id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'STOPPED' OR stop_reason IS NOT NULL)
);

CREATE TABLE installation_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  installation_id  uuid NOT NULL REFERENCES installations(id),
  status           install_status NOT NULL,
  note             text,
  actor_id         uuid NOT NULL REFERENCES users(id),
  at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE down_payments (                          -- Ecofy collects (S7.2); platform records only
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  case_id       uuid NOT NULL REFERENCES cases(id),
  visible_to    user_role NOT NULL,                  -- from the financier: Ecofy Admin for Ecofy
  received_on   date NOT NULL,
  amount_inr    int NOT NULL CHECK (amount_inr > 0),
  reference     text,
  recorded_by   uuid NOT NULL REFERENCES users(id),
  recorded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE disbursements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  case_id        uuid NOT NULL UNIQUE REFERENCES cases(id),
  decision_id    uuid NOT NULL REFERENCES financing_decisions(id),
  visible_to     user_role NOT NULL,                 -- from the financier: Ecofy Admin for Ecofy
  disbursed_on   date NOT NULL,
  amount_inr     int NOT NULL CHECK (amount_inr > 0),
  reference      text,
  recorded_by    uuid NOT NULL REFERENCES users(id),
  recorded_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ K. ASSET (S8)
CREATE TABLE assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  case_id         uuid NOT NULL UNIQUE REFERENCES cases(id),
  system_snapshot jsonb NOT NULL,
  commissioned_on date NOT NULL,
  status          asset_status NOT NULL DEFAULT 'ACTIVE',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE emi_status_updates (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  asset_id     uuid NOT NULL REFERENCES assets(id),
  as_of        date NOT NULL,
  state        emi_state NOT NULL,
  note         text,
  recorded_by  uuid NOT NULL REFERENCES users(id),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, as_of)
);

CREATE TABLE asset_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  asset_id     uuid NOT NULL REFERENCES assets(id),
  type         text NOT NULL CHECK (type IN ('BUYBACK','REDEPLOYED','CLOSED')),
  on_date      date NOT NULL,
  note         text,
  recorded_by  uuid NOT NULL REFERENCES users(id),
  recorded_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================ L. WITHDRAWAL
CREATE TABLE withdrawals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id),
  case_id               uuid NOT NULL REFERENCES cases(id),
  stage_at_request      case_stage NOT NULL,
  reason                text NOT NULL,
  status                withdraw_status NOT NULL DEFAULT 'REQUESTED',
  requested_by          uuid NOT NULL REFERENCES users(id),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_by          uuid REFERENCES users(id),        -- iTarang Admin after acceptance (W.3)
  confirmed_at          timestamptz,
  ecofy_alerted_at      timestamptz,
  sanction_cancelled_at timestamptz,
  epc_informed_at       timestamptz
);
CREATE UNIQUE INDEX one_open_withdrawal ON withdrawals (case_id) WHERE status = 'REQUESTED';

-- ============================================================ M. DOCUMENTS
CREATE TABLE documents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  case_id           uuid REFERENCES cases(id),
  UNIQUE (id, case_id),                             -- target for same-case foreign keys
  type_code         text NOT NULL,                  -- list document_type; KYC types are not in the list
  s3_key            text NOT NULL UNIQUE,
  file_name         text NOT NULL,
  mime_type         text NOT NULL,
  size_bytes        int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256            char(64) NOT NULL,
  recording_consent boolean,                        -- required for call recordings
  retention_until   date,                           -- recordings: upload + 60 days (S0.3)
  uploaded_by       uuid NOT NULL REFERENCES users(id),
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  CHECK (type_code <> 'CALL_RECORDING' OR (recording_consent AND retention_until IS NOT NULL))
);
-- quotes are created earlier in this file; their PDF must be a document of the same case
ALTER TABLE quotes ADD FOREIGN KEY (document_id, case_id) REFERENCES documents(id, case_id);

CREATE INDEX docs_case_idx ON documents (case_id) WHERE deleted_at IS NULL;
CREATE INDEX docs_retention_idx ON documents (retention_until) WHERE deleted_at IS NULL AND retention_until IS NOT NULL;

ALTER TABLE quotes ADD CONSTRAINT quotes_document_fk FOREIGN KEY (document_id) REFERENCES documents(id);

-- ============================================================ N. NOTIFICATIONS + SMS
CREATE TABLE notifications (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  type        text NOT NULL,
  title       text NOT NULL,
  body        text,
  case_id     uuid REFERENCES cases(id),
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notif_user_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE sms_messages (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  case_id          uuid REFERENCES cases(id),
  dlt_template_id  text NOT NULL,
  to_mobile_e164   text NOT NULL,
  purpose          text NOT NULL,
  provider         text NOT NULL DEFAULT 'GUPSHUP',
  provider_msg_id  text,
  status           text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','DELIVERED','FAILED')),
  sent_at          timestamptz,
  delivered_at     timestamptz
);

-- ============================================================ N2. IDEMPOTENCY
CREATE TABLE idempotency_keys (                      -- replays of OTP send, import commit, quote commit, offer create
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  key            text NOT NULL,
  user_id        uuid NOT NULL REFERENCES users(id),
  route          text NOT NULL,
  request_hash   char(64) NOT NULL,                  -- same key + different body = 422
  status_code    smallint,
  response       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(), -- purged after 24 hours
  PRIMARY KEY (tenant_id, key)
);

-- ============================================================ O. AUDIT + EVENTS
CREATE TABLE audit_log (                             -- INSERT-only for ecofy_app
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  actor_id     uuid REFERENCES users(id),
  actor_role   user_role,
  action       text NOT NULL,                        -- e.g. case.assign, export.generate
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  case_id      uuid,
  before       jsonb,
  after        jsonb,
  reason       text,
  ip           inet,
  user_agent   text,
  at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_case_idx ON audit_log (case_id, at);
CREATE INDEX audit_actor_idx ON audit_log (tenant_id, actor_id, at);

CREATE TABLE outbox_events (                         -- written in the same transaction as the change
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  event_type    text NOT NULL,                       -- e.g. case.stage_changed
  aggregate_id  uuid NOT NULL,
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz
);
CREATE INDEX outbox_unpublished ON outbox_events (id) WHERE published_at IS NULL;

-- ============================================================ P. REPORTING
CREATE VIEW v_case_ageing WITH (security_invoker = true) AS
SELECT c.tenant_id, c.id AS case_id, c.case_no, c.stage, c.assigned_user_id, c.owner_org_id,
       now() - c.stage_entered_at  AS in_stage_for,
       now() - c.created_at        AS open_for,
       c.first_call_at - c.queue_entered_at AS hot_to_first_call
FROM cases c
WHERE c.stage <> 'CLOSED';

CREATE TABLE funnel_daily (                          -- nightly rollup for dashboards
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  day         date NOT NULL,
  user_id     uuid,
  stage       case_stage NOT NULL,
  entered     int NOT NULL DEFAULT 0,
  exited      int NOT NULL DEFAULT 0,
  open_at_eod int NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX funnel_daily_key ON funnel_daily (tenant_id, day, stage, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ============================================================ Q. ROW-LEVEL SECURITY
-- Helper reading per-request settings (SET LOCAL app.tenant_id / app.user_id / app.role)
CREATE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app_user()   RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION app_role()   RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('app.role', true) $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_domains','user_sessions','trusted_devices','import_rows','calc_appliances','calc_systems',
    'orgs','users','seat_limits','seat_ledger','settings','list_items','working_hours','holidays',
    'epc_partners','financiers','column_mappings','import_batches','customers','cases','case_stage_history',
    'case_assignments','case_returns','activities','appointments','calc_releases','assessments','eligibility_checks',
    'quote_requests','quotes','offers','otp_challenges','files','file_acceptances','financing_decisions',
    'installations','installation_events','down_payments','disbursements','assets','emi_status_updates',
    'asset_events','withdrawals','documents','notifications','sms_messages','idempotency_keys','audit_log','outbox_events','funnel_daily']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

-- Case scope (API enforces the same; this is the backstop):
--   iTarang Admin: all cases
--   Ecofy Admin:   cases where Ecofy is the lead source or the current financier
--   workers:       cases assigned to them, or (Ecofy User) qualified by them
CREATE POLICY case_scope ON cases AS RESTRICTIVE
  USING (
    app_role() = 'ITARANG_ADMIN'
    OR (app_role() = 'ECOFY_ADMIN' AND (
          owner_org_id IN (SELECT o.id FROM orgs o WHERE o.kind = 'ECOFY')
          OR financier_id IN (SELECT f.id FROM financiers f WHERE f.is_default)))
    OR (app_role() IN ('ECOFY_USER','ITARANG_CALLER') AND (assigned_user_id = app_user() OR qualified_by = app_user()))
  );

-- Money: readable and writable only by the role named on the row
ALTER TABLE eligibility_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY values_role ON eligibility_values
  USING (tenant_id = app_tenant() AND visible_to::text = app_role())
  WITH CHECK (tenant_id = app_tenant() AND visible_to::text = app_role());
ALTER TABLE financing_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY values_role ON financing_values
  USING (tenant_id = app_tenant() AND visible_to::text = app_role())
  WITH CHECK (tenant_id = app_tenant() AND visible_to::text = app_role());
CREATE POLICY dp_role ON down_payments AS RESTRICTIVE
  USING (visible_to::text = app_role()) WITH CHECK (visible_to::text = app_role());
CREATE POLICY disb_role ON disbursements AS RESTRICTIVE
  USING (visible_to::text = app_role()) WITH CHECK (visible_to::text = app_role());

-- The caller needs to know only whether a quote fits the limit, never the limit itself (S4.6).
-- SECURITY DEFINER reads the hidden amount and returns a yes / no only.
CREATE FUNCTION offer_within_limit(p_case uuid, p_total int) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_total <= v.max_eligible_inr
  FROM eligibility_checks e
  JOIN eligibility_values v ON v.eligibility_id = e.id
  JOIN cases c ON c.id = e.case_id AND c.financier_id = e.financier_id
  WHERE e.case_id = p_case AND e.status = 'ELIGIBLE' AND e.tenant_id = app_tenant()
  ORDER BY e.decided_at DESC NULLS LAST
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION offer_within_limit(uuid, int) FROM PUBLIC;

-- A closed case that already reached a File is never reopened; a re-upload creates a new case
-- linked through previous_case_id (the File is never reversed).
CREATE FUNCTION block_reopen_with_file() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stage = 'CLOSED' AND NEW.stage <> 'CLOSED'
     AND EXISTS (SELECT 1 FROM files f WHERE f.case_id = OLD.id) THEN
    RAISE EXCEPTION 'case % has a File and cannot be reopened; create a new linked case', OLD.case_no
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cases_block_reopen BEFORE UPDATE OF stage ON cases
  FOR EACH ROW EXECUTE FUNCTION block_reopen_with_file();

-- tenants: a session sees only its own tenant row
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self ON tenants USING (id = app_tenant());

-- Host -> tenant, the only lookup allowed before app.tenant_id is set
CREATE FUNCTION resolve_tenant(p_host text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.tenant_id FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id
  WHERE d.host = p_host::citext AND t.status <> 'EXITED'
$$;
REVOKE ALL ON FUNCTION resolve_tenant(text) FROM PUBLIC;

-- Earned rule 3: a quote against an assessment still waiting for power / load data
-- must be marked provisional (reason enforced by the CHECK on quotes)
CREATE FUNCTION quote_provisional_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM assessments a
             WHERE a.id = NEW.assessment_id AND a.recommendation_status = 'PENDING_TECHNICAL_DATA')
     AND NOT NEW.provisional THEN
    RAISE EXCEPTION 'quote answers an assessment pending technical data; mark it provisional with a reason'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM assessments a WHERE a.id = NEW.assessment_id AND a.case_id = NEW.case_id) THEN
    RAISE EXCEPTION 'quote assessment belongs to another case' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quotes_provisional_guard BEFORE INSERT OR UPDATE OF assessment_id, provisional ON quotes
  FOR EACH ROW EXECUTE FUNCTION quote_provisional_guard();

-- File lineage (the billable event): the File must match the quote it names and the
-- verified acceptance OTP must confirm an offer built on that same quote.
CREATE FUNCTION file_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE q record; o record;
BEGIN
  SELECT total_inr, status, valid_until INTO q FROM quotes
  WHERE id = NEW.accepted_quote_id AND case_id = NEW.case_id AND version = NEW.quote_version;
  IF NOT FOUND THEN RETURN NEW; END IF;          -- wrong case or version: the composite foreign key rejects it
  IF NEW.accepted_total_inr <> q.total_inr THEN
    RAISE EXCEPTION 'File total % differs from quote total %', NEW.accepted_total_inr, q.total_inr USING ERRCODE = 'check_violation';
  END IF;
  IF q.status NOT IN ('ACTIVE','ACCEPTED') THEN
    RAISE EXCEPTION 'quote is % and cannot be accepted', q.status USING ERRCODE = 'check_violation';
  END IF;
  IF q.valid_until < (NEW.accepted_at AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'quote expired on %', q.valid_until USING ERRCODE = 'check_violation';
  END IF;
  SELECT c.status, c.purpose, f.quote_id INTO o
  FROM otp_challenges c JOIN offers f ON f.id = c.offer_id
  WHERE c.id = NEW.otp_challenge_id AND c.case_id = NEW.case_id;
  IF NOT FOUND THEN RETURN NEW; END IF;          -- OTP of another case: the composite foreign key rejects it
  IF o.status <> 'VERIFIED' OR o.purpose <> 'ACCEPTANCE' THEN
    RAISE EXCEPTION 'File needs a VERIFIED acceptance OTP (got % / %)', o.status, o.purpose USING ERRCODE = 'check_violation';
  END IF;
  IF o.quote_id <> NEW.accepted_quote_id THEN
    RAISE EXCEPTION 'the verified OTP confirmed an offer on a different quote' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER files_lineage_guard BEFORE INSERT ON files
  FOR EACH ROW EXECUTE FUNCTION file_lineage_guard();

CREATE FUNCTION acceptance_lineage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c record; f_otp uuid;
BEGIN
  SELECT status, purpose, offer_id INTO c FROM otp_challenges WHERE id = NEW.otp_challenge_id;
  SELECT otp_challenge_id INTO f_otp FROM files WHERE id = NEW.file_id;
  IF c.status <> 'VERIFIED' OR c.offer_id <> NEW.offer_id THEN
    RAISE EXCEPTION 'acceptance needs the VERIFIED OTP of this offer' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'INITIAL' AND (c.purpose <> 'ACCEPTANCE' OR NEW.otp_challenge_id <> f_otp) THEN
    RAISE EXCEPTION 'INITIAL acceptance must be the File''s own acceptance OTP' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.kind = 'REVISED' AND c.purpose <> 'REACCEPTANCE' THEN
    RAISE EXCEPTION 'REVISED acceptance needs a REACCEPTANCE OTP' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER file_acceptances_lineage_guard BEFORE INSERT ON file_acceptances
  FOR EACH ROW EXECUTE FUNCTION acceptance_lineage_guard();

-- ============================================================ R. APP ROLE + GRANTS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ecofy_app') THEN
    CREATE ROLE ecofy_app LOGIN;             -- password set from Secrets Manager, not here
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO ecofy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ecofy_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ecofy_app;
GRANT EXECUTE ON FUNCTION offer_within_limit(uuid, int) TO ecofy_app;
GRANT EXECUTE ON FUNCTION resolve_tenant(text) TO ecofy_app;
REVOKE INSERT, UPDATE, DELETE ON tenants, tenant_domains FROM ecofy_app;
REVOKE UPDATE, DELETE ON audit_log, activities, case_stage_history, seat_ledger, installation_events, file_acceptances FROM ecofy_app;
REVOKE DELETE ON files, cases, customers, quotes, offers, otp_challenges FROM ecofy_app;
-- A File is never edited; quotes, offers and OTPs change status only, never their terms
REVOKE UPDATE ON files, quotes, offers, otp_challenges FROM ecofy_app;
GRANT UPDATE (status) ON quotes TO ecofy_app;
GRANT UPDATE (status, sent_at) ON offers TO ecofy_app;
GRANT UPDATE (status, attempts, verified_at, provider_msg_id) ON otp_challenges TO ecofy_app;
-- cross-database isolation (run as superuser on the shared instance):
--   REVOKE CONNECT ON DATABASE <crm_db>, tarudb FROM ecofy_app;
