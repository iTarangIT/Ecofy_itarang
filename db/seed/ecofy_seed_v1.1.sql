-- =====================================================================
-- ecofydb seed v1.1  ·  Calculator Release v1 and every go-live default
-- Run ONCE on production and sandbox, after ecofy_schema_v1.4.sql, as the
-- owner role (not ecofy_app):
--   psql -v ON_ERROR_STOP=1 -v host=ecofy.itarang.com \
--        -v ia_email=<iTarang Admin email> -v ia_name='<full name>' \
--        -d ecofydb -f ecofy_seed_v1.1.sql
-- Values marked [BUSINESS] come from the business review (Build Baseline,
-- see README for the current version); v1.1 changes references only, not data; [DEFAULT] are iTarang defaults, editable in the admin portal.
-- Standard systems are NOT seeded: iTarang Admin enters them in the
-- Calculator Designer from Ecofy / EPC input before Ecofy approves v1.
-- =====================================================================
\set ON_ERROR_STOP 1
\if :{?host}
\else
  \echo 'Missing -v host=...'
  \quit
\endif
\if :{?ia_email}
\else
  \echo 'Missing -v ia_email=...'
  \quit
\endif
\if :{?ia_name}
\else
  \echo 'Missing -v ia_name=...'
  \quit
\endif

SELECT set_config('seed.host', :'host', false),
       set_config('seed.ia_email', :'ia_email', false),
       set_config('seed.ia_name', :'ia_name', false) \g /dev/null

BEGIN;

DO $$
DECLARE
  t   uuid;
  o_e uuid;
  o_i uuid;
  ia  uuid;
  rel uuid;
BEGIN
  -- ---------------------------------------------------------------- tenant, orgs
  INSERT INTO tenants(code, name) VALUES ('ECOFY', 'Ecofy') RETURNING id INTO t;
  INSERT INTO tenant_domains(tenant_id, host, is_primary) VALUES (t, current_setting('seed.host'), true);
  INSERT INTO orgs(tenant_id, kind, name) VALUES (t, 'ECOFY', 'Ecofy') RETURNING id INTO o_e;
  INSERT INTO orgs(tenant_id, kind, name) VALUES (t, 'ITARANG', 'iTarang') RETURNING id INTO o_i;

  -- bootstrap iTarang Admin (INVITED; linked to Supabase on first login)
  INSERT INTO users(tenant_id, org_id, full_name, email, role, status)
  VALUES (t, o_i, current_setting('seed.ia_name'), current_setting('seed.ia_email'), 'ITARANG_ADMIN', 'INVITED')
  RETURNING id INTO ia;

  -- ---------------------------------------------------------------- seats [BUSINESS]
  INSERT INTO seat_limits(tenant_id, role, seat_limit, seats_used) VALUES
    (t, 'ECOFY_ADMIN', 1, 0), (t, 'ECOFY_USER', 2, 0), (t, 'ITARANG_ADMIN', 1, 1), (t, 'ITARANG_CALLER', 1, 0);
  INSERT INTO seat_ledger(tenant_id, role, action, user_id, actor_id) VALUES (t, 'ITARANG_ADMIN', 'SEAT_ADDED', ia, ia);

  -- ---------------------------------------------------------------- settings
  INSERT INTO settings(tenant_id, key, value, updated_by) VALUES
    (t, 'intake.max_rows',                         '5000', ia),                                   -- [DEFAULT]
    (t, 'intake.consent_attestation_text',         '"I confirm Ecofy holds consent from every customer in this file to be contacted about solar and storage products by Ecofy and iTarang on its behalf."', ia),
    (t, 'imports.raw_retention_days',              '30', ia),                                     -- [DEFAULT] file + raw rows purged
    (t, 'permissions.ecofy_docs_after_handoff',    'false', ia),                                  -- [BUSINESS] S0.2: comments only
    (t, 'recordings.retention_days',               '60', ia),                                     -- [BUSINESS] S0.3
    (t, 'ageing.bands_working_days',               '[1, 3, 7]', ia),                              -- [DEFAULT] 0-1, 1-3, 3-7, 7+
    (t, 'gates.meeting_before_assessment',         'true', ia),                                   -- [BUSINESS] S2.3
    (t, 'gates.s4_order',                          '"ELIGIBILITY_FIRST"', ia),                    -- [BUSINESS] S4.1 (ELIGIBILITY_FIRST | QUOTE_FIRST | PARALLEL)
    (t, 'gates.sanction_before_installation',      'false', ia),                                  -- [BUSINESS] S6.4 (warning shown)
    (t, 'gates.down_payment_before_installation',  'false', ia),                                  -- [DEFAULT] S7.2 not answered
    (t, 'gates.allow_provisional_quote_acceptance','true', ia),                                   -- earned rule 3
    (t, 'quotes.default_validity_days',            '30', ia),                                     -- [DEFAULT]
    (t, 'otp.length',                              '6', ia),
    (t, 'otp.expiry_minutes',                      '10', ia),
    (t, 'otp.max_attempts',                        '5', ia),
    (t, 'otp.resend_after_seconds',                '60', ia),
    (t, 'otp.max_sends_per_offer_per_hour',        '3', ia),
    (t, 'sms.sender_id',                           'null', ia),                                   -- fill from Gupshup before go-live
    (t, 'sms.dlt_template_acceptance',             'null', ia),                                   -- existing DLT template id
    (t, 'sms.dlt_template_reacceptance',           'null', ia),                                   -- new template with amounts (apply now)
    (t, 'auth.device_verification_required',       'true', ia),                                   -- false = no new-device email code (staging/dev)
    (t, 'auth.device_otp_expiry_minutes',          '10', ia),
    (t, 'auth.device_otp_max_attempts',            '5', ia),
    (t, 'auth.device_lockout_minutes',             '15', ia),
    (t, 'auth.trusted_device_days',                '30', ia),
    (t, 'systems.price_refresh_days',              '30', ia),                                     -- [DEFAULT] C.1 refresh reminder
    (t, 'appointments.reminder_minutes_before',    '60', ia),
    (t, 'notifications.admin_daily_digest',        'false', ia),
    (t, 'exports.mask_mobile_in_lists',            'true', ia),
    (t, 'idempotency.ttl_hours',                   '24', ia),
    (t, 'billing.usage_view_enabled',              'true', ia);                                   -- counts only, never blocks

  -- ---------------------------------------------------------------- lists
  INSERT INTO list_items(tenant_id, list_code, code, label, sort_order) VALUES
    -- return reasons [BUSINESS S1.3: the six agreed]
    (t,'return_reason','WRONG_NUMBER','Wrong number',1), (t,'return_reason','NOT_INTERESTED','Not interested',2),
    (t,'return_reason','WANTS_LATER','Wants a call later',3), (t,'return_reason','DUPLICATE','Duplicate',4),
    (t,'return_reason','OUT_OF_AREA','Out of service area',5), (t,'return_reason','REQUALIFY','Needs requalification',6),
    -- closure reasons [DEFAULT]
    (t,'closure_reason','NOT_INTERESTED','Not interested',1), (t,'closure_reason','UNREACHABLE','Unreachable',2),
    (t,'closure_reason','DUPLICATE','Duplicate',3), (t,'closure_reason','OUT_OF_AREA','Out of service area',4),
    (t,'closure_reason','WITHDRAWN','Customer withdrew',5), (t,'closure_reason','REJECTED_ALL_FINANCIERS','Rejected by all financiers',6),
    -- meeting types [BUSINESS S2.2]
    (t,'meeting_type','PHONE','Phone',1), (t,'meeting_type','VIDEO','Video',2),
    (t,'meeting_type','SITE_VISIT','Site visit',3), (t,'meeting_type','EPC_VISIT','EPC site visit',4),
    -- document types (no KYC types; the database rejects them) [BUSINESS S7.3]
    (t,'document_type','ELECTRICITY_BILL','Electricity bill',1), (t,'document_type','SITE_PHOTO','Site photo',2),
    (t,'document_type','CUSTOMER_NOTE','Customer note',3), (t,'document_type','CALL_RECORDING','Call recording',4),
    (t,'document_type','EPC_QUOTE','EPC quote',5), (t,'document_type','EPC_VISIT_PHOTO','EPC visit photo',6),
    (t,'document_type','INSTALLATION_PHOTO','Installation photo',7), (t,'document_type','CUSTOMER_ACCEPTANCE_LETTER','Customer acceptance letter',8),
    (t,'document_type','OTHER','Other',9),
    -- languages [BUSINESS L.6]
    (t,'language','HINDI','Hindi',1), (t,'language','MARATHI','Marathi',2), (t,'language','ENGLISH','English',3),
    (t,'language','MARWARI','Marwari',4), (t,'language','OTHER','Other',5),
    -- consent sources
    (t,'consent_source','WEBSITE_FORM','Website form',1), (t,'consent_source','CALL','Call',2), (t,'consent_source','CAMPAIGN','Campaign',3),
    (t,'consent_source','WALK_IN','Walk-in',4), (t,'consent_source','EXISTING_CUSTOMER','Existing customer',5),
    (t,'consent_source','REFERRAL','Referral',6), (t,'consent_source','OTHER','Other',7),
    -- property types
    (t,'property_type','OWN_HOUSE','Own house',1), (t,'property_type','RENTED_HOUSE','Rented house',2), (t,'property_type','OWN_SHOP','Own shop',3),
    (t,'property_type','RENTED_SHOP','Rented shop',4), (t,'property_type','FACTORY','Factory',5), (t,'property_type','OFFICE','Office',6),
    (t,'property_type','OTHER','Other',7),
    -- product interest (maps to standard system type)
    (t,'product_interest','SOLAR_STORAGE','Solar + storage',1), (t,'product_interest','STORAGE_ONLY','Storage only',2),
    (t,'product_interest','SOLAR_ONLY','Solar only',3), (t,'product_interest','NOT_SURE','Not sure',4),
    -- existing backup
    (t,'existing_backup','NONE','None',1), (t,'existing_backup','INVERTER','Inverter',2),
    (t,'existing_backup','GENERATOR','Generator',3), (t,'existing_backup','BOTH','Both',4),
    -- preferred call time
    (t,'call_time','MORNING','Morning',1), (t,'call_time','AFTERNOON','Afternoon',2),
    (t,'call_time','EVENING','Evening',3), (t,'call_time','ANY','Any',4);

  -- ---------------------------------------------------------------- calendar [BUSINESS S1.2]
  INSERT INTO working_hours(tenant_id, weekday, start_time, end_time)
  SELECT t, d, '10:00', '19:00' FROM generate_series(1, 5) d;       -- Mon-Fri 10:00-19:00; holidays added by iTarang Admin

  -- ---------------------------------------------------------------- financier [BUSINESS]
  INSERT INTO financiers(tenant_id, name, is_default, values_visible_to) VALUES (t, 'Ecofy', true, 'ECOFY_ADMIN');

  -- ---------------------------------------------------------------- Calculator Release v1 (DRAFT until Ecofy approves)
  INSERT INTO calc_releases(tenant_id, version, status, params, change_note, created_by) VALUES (t, 1, 'DRAFT', $json${
    "formula": "FIXED_9_STEP_V1",
    "values": {
      "usable_share": 0.90,
      "inverter_efficiency": 0.90,
      "surge_headroom": 0.10,
      "power_factor": 0.8,
      "solar_units_per_kwp_per_day": 4,
      "days_per_month": 30
    },
    "segments": {
      "RESI": {"enabled": true,  "inputs": ["APPLIANCES", "MONTHLY_UNITS"]},
      "ESS":  {"enabled": true,  "inputs": ["APPLIANCES", "MONTHLY_UNITS", "RUNNING_LOAD"]},
      "CI":   {"enabled": false, "message_key": "ci_message"}
    },
    "always_ask": ["BACKUP_HOURS", "PHASE"],
    "rules": {
      "alternatives_smaller": 1,
      "alternatives_larger": 1,
      "phase_must_match": true,
      "system_type_follows_product_interest": true,
      "not_sure_interest_allows_types": ["SOLAR_STORAGE", "STORAGE_ONLY", "SOLAR_ONLY"],
      "match_by_type": {
        "SOLAR_STORAGE": ["USABLE_BATTERY", "INVERTER", "SOLAR"],
        "STORAGE_ONLY":  ["USABLE_BATTERY", "INVERTER"],
        "SOLAR_ONLY":    ["SOLAR"]
      },
      "skip_backup_inputs_for_types": ["SOLAR_ONLY"],
      "motor_start": "LARGEST_MOTOR_ONLY",
      "bill_only_power_source": "SANCTIONED_LOAD",
      "pending_when_need_unknown": {
        "power":   ["APPLIANCES", "RUNNING_LOAD", "SANCTIONED_LOAD"],
        "battery": ["APPLIANCES", "RUNNING_LOAD", "MONTHLY_UNITS"],
        "solar":   ["MONTHLY_UNITS"]
      }
    },
    "display": {
      "price": "RANGE",
      "gst_separate": true,
      "installation_separate": true
    },
    "texts": {
      "disclaimer": "Indicative price range. The final price comes from the EPC partner's quote.",
      "financing_line": "Financing through Ecofy, subject to sanction.",
      "custom_required": "No standard system fits. Custom configuration required; request an EPC quote.",
      "pending_technical_data": "Recommendation pending: power or load details are missing. A provisional EPC quote needs a recorded reason.",
      "ci_message": "EPC quote required."
    }
  }$json$::jsonb, '[BUSINESS] values from the review; rules per BRD M07', ia)
  RETURNING id INTO rel;

  -- appliances [BUSINESS: all 14 watts confirmed]; motor multipliers [DEFAULT, C.7]
  INSERT INTO calc_appliances(tenant_id, release_id, name, default_watts, is_motor, start_multiplier, sort_order) VALUES
    (t, rel, 'LED bulb',                   10, false, 1,  1),
    (t, rel, 'LED tube light',             20, false, 1,  2),
    (t, rel, 'Ceiling fan',                75, false, 1,  3),
    (t, rel, 'Wi-Fi router',               15, false, 1,  4),
    (t, rel, 'Laptop',                     60, false, 1,  5),
    (t, rel, 'Television',                100, false, 1,  6),
    (t, rel, 'Desktop computer',          150, false, 1,  7),
    (t, rel, 'Refrigerator',              200, true,  3,  8),
    (t, rel, 'Air cooler',                200, false, 1,  9),
    (t, rel, 'Washing machine',           500, true,  2, 10),
    (t, rel, 'Mixer grinder',             500, true,  2, 11),
    (t, rel, 'Water pump (1 HP)',         750, true,  3, 12),
    (t, rel, 'Air conditioner (1 ton)',  1200, true,  3, 13),
    (t, rel, 'Air conditioner (1.5 ton)',1600, true,  3, 14);

  INSERT INTO audit_log(tenant_id, actor_id, actor_role, action, entity_type, entity_id, reason)
  VALUES (t, ia, 'ITARANG_ADMIN', 'seed.applied', 'tenant', t::text, 'ecofy_seed_v1.1');
END $$;

COMMIT;
\echo 'Seed v1.1 applied'
