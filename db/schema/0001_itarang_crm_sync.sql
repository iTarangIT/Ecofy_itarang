-- ============================================================ 0001. iTarang CRM sync (docs/CONFLICTS.md #24)
-- Additive to 0000_ecofy_schema_v1.4.sql (never edited). Applied by `npm run db:migrate`.
-- Ecofy and the iTarang CRM (sandbox.itarang.com) keep separate databases; they exchange signed
-- HTTPS events. These tables hold the cross-system id, the outbound delivery queue and the inbound
-- de-duplication log.

-- One Ecofy case ↔ one iTarang CRM lead
CREATE TABLE integration_links (
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  system       text NOT NULL CHECK (system IN ('ITARANG_CRM')),
  case_id      uuid NOT NULL REFERENCES cases(id),
  external_id  text NOT NULL,                          -- lead id in the other system
  linked_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, system, case_id),
  UNIQUE (tenant_id, system, external_id)
);

-- Outbound: one row per outbox event forwarded; the worker sends due rows with back-off.
-- Kept apart from outbox_events so a slow or down CRM never blocks the outbox relay.
CREATE TABLE integration_deliveries (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  system           text NOT NULL CHECK (system IN ('ITARANG_CRM')),
  outbox_event_id  bigint NOT NULL,                    -- source event; makes the handler idempotent
  event_type       text NOT NULL,                      -- e.g. lead.pushed
  case_id          uuid REFERENCES cases(id),
  body             jsonb NOT NULL,                     -- exact JSON sent (signed at send time)
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','DEAD')),
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_status      smallint,                           -- last HTTP status (null = network error)
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  UNIQUE (tenant_id, system, outbox_event_id)
);
CREATE INDEX integration_deliveries_due ON integration_deliveries (tenant_id, next_attempt_at) WHERE status = 'PENDING';
CREATE INDEX integration_deliveries_case ON integration_deliveries (tenant_id, case_id, id);

-- Inbound: every accepted event id once, so a retried webhook is applied at most once
CREATE TABLE integration_inbox (
  tenant_id    uuid NOT NULL REFERENCES tenants(id),
  system       text NOT NULL CHECK (system IN ('ITARANG_CRM')),
  event_id     text NOT NULL,
  event_type   text NOT NULL,
  case_id      uuid,
  status       text NOT NULL CHECK (status IN ('APPLIED','REJECTED')),
  http_status  smallint NOT NULL,
  result       jsonb NOT NULL,                         -- response body replayed for a duplicate
  received_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, system, event_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['integration_links','integration_deliveries','integration_inbox']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON integration_links, integration_inbox TO ecofy_app;
GRANT SELECT, INSERT, UPDATE ON integration_deliveries TO ecofy_app;
GRANT USAGE, SELECT ON SEQUENCE integration_deliveries_id_seq TO ecofy_app;
