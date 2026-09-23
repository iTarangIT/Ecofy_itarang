-- =====================================================================
-- ecofydb schema tests v1.4  ·  run on a DISPOSABLE database after
-- ecofy_schema_v1.4.sql, as the owner role:
--   psql -v ON_ERROR_STOP=1 -d <db> -f ecofy_schema_tests_v1.4.sql
-- Any failed check raises an exception and psql exits non-zero (CI fails).
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

CREATE FUNCTION pg_temp.as_app(p_tenant uuid, p_user uuid, p_role text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('app.tenant_id', coalesce(p_tenant::text, ''), true);
  PERFORM set_config('app.user_id',   coalesce(p_user::text, ''), true);
  PERFORM set_config('app.role',      coalesce(p_role, ''), true);
  EXECUTE 'SET LOCAL ROLE ecofy_app';
END $$;

-- ------------------------------------------------------------ fixture (as owner)
-- tenant A = 'TEST', tenant B = 'OTHER'
INSERT INTO tenants(id,code,name) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000000','TEST','Test tenant'),
 ('bbbbbbbb-0000-0000-0000-000000000000','OTHER','Other tenant');
INSERT INTO tenant_domains(tenant_id,host) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000000','test.example.com'),
 ('bbbbbbbb-0000-0000-0000-000000000000','other.example.com');
INSERT INTO orgs(id,tenant_id,kind,name) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-000000000000','ECOFY','Ecofy'),
 ('aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-000000000000','ITARANG','iTarang'),
 ('bbbbbbbb-0000-0000-0000-0000000000e1','bbbbbbbb-0000-0000-0000-000000000000','ECOFY','Ecofy B');
INSERT INTO users(id,tenant_id,org_id,full_name,email,role,status) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000e1','EA','ea@t.in','ECOFY_ADMIN','ACTIVE'),
 ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000e1','EU','eu@t.in','ECOFY_USER','ACTIVE'),
 ('aaaaaaaa-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000f1','IA','ia@t.in','ITARANG_ADMIN','ACTIVE'),
 ('aaaaaaaa-0000-0000-0000-0000000000a4','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000f1','IC','ic@t.in','ITARANG_CALLER','ACTIVE'),
 ('bbbbbbbb-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-0000000000e1','EA-B','ea@b.in','ECOFY_ADMIN','ACTIVE');
INSERT INTO seat_limits VALUES ('aaaaaaaa-0000-0000-0000-000000000000','ECOFY_USER',2,1);
INSERT INTO user_sessions(user_id,tenant_id,session_id) VALUES ('bbbbbbbb-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000000','sess-b');
INSERT INTO financiers(id,tenant_id,name,is_default,values_visible_to) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000b1','aaaaaaaa-0000-0000-0000-000000000000','Ecofy',true,'ECOFY_ADMIN'),
 ('aaaaaaaa-0000-0000-0000-0000000000b2','aaaaaaaa-0000-0000-0000-000000000000','Other NBFC',false,'ITARANG_ADMIN');
INSERT INTO customers(id,tenant_id,full_name,mobile_e164,customer_type,address,city,state,pincode,consent_obtained,consent_date,consent_source) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-000000000000','Rohit','+919876543210','INDIVIDUAL','H12','Gurugram','Haryana','122001',true,'2026-09-15','WEBSITE_FORM'),
 ('aaaaaaaa-0000-0000-0000-0000000000c2','aaaaaaaa-0000-0000-0000-000000000000','Asha','+919812345670','INDIVIDUAL','H1','Pune','Maharashtra','411001',true,'2026-09-15','REFERRAL');
INSERT INTO cases(id,tenant_id,customer_id,segment,source,owner_org_id,stage,qualified_by,assigned_user_id,financier_id) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000c1','RESI','ECOFY_UPLOAD','aaaaaaaa-0000-0000-0000-0000000000e1','S4','aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-0000000000a4','aaaaaaaa-0000-0000-0000-0000000000b1'),
 ('aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000c2','RESI','ITARANG_SOURCED','aaaaaaaa-0000-0000-0000-0000000000f1','S6',NULL,'aaaaaaaa-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-0000000000b2');
INSERT INTO eligibility_checks(id,tenant_id,case_id,financier_id,status,requested_by,decided_at) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000e9','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-0000000000b1','ELIGIBLE','aaaaaaaa-0000-0000-0000-0000000000a4',now());
INSERT INTO eligibility_values VALUES ('aaaaaaaa-0000-0000-0000-0000000000e9','aaaaaaaa-0000-0000-0000-000000000000','ECOFY_ADMIN',250000,'aaaaaaaa-0000-0000-0000-0000000000a1');
INSERT INTO import_batches(id,tenant_id,uploaded_by,file_key,file_name) VALUES
 ('bbbbbbbb-0000-0000-0000-00000000aa01','bbbbbbbb-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-0000000000a1','k','b.xlsx');
INSERT INTO import_rows(tenant_id,batch_id,row_no,raw) VALUES ('bbbbbbbb-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-00000000aa01',1,'{"mobile":"9999999999"}');
INSERT INTO calc_releases(id,tenant_id,version,status,params,created_by) VALUES
 ('bbbbbbbb-0000-0000-0000-00000000ca01','bbbbbbbb-0000-0000-0000-000000000000',1,'PUBLISHED','{}','bbbbbbbb-0000-0000-0000-0000000000a1'),
 ('aaaaaaaa-0000-0000-0000-00000000ca01','aaaaaaaa-0000-0000-0000-000000000000',1,'PUBLISHED','{}','aaaaaaaa-0000-0000-0000-0000000000a3');
INSERT INTO calc_systems(tenant_id,release_id,system_code,system_name,for_resi,for_ess,for_ci,system_type,battery_capacity_kwh,usable_capacity_kwh,inverter_kva,inverter_type,phase,solar_kwp,equipment_price_min_inr,equipment_price_max_inr,installation_price_min_inr,installation_price_max_inr,gst_pct,price_updated_on)
 VALUES ('bbbbbbbb-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-00000000ca01','B-1','B system',true,false,false,'STORAGE_ONLY',5,4.5,5,'OFF_GRID','SINGLE',0,100,200,10,20,12,'2026-09-01');
INSERT INTO documents(id,tenant_id,case_id,type_code,s3_key,file_name,mime_type,size_bytes,sha256,uploaded_by) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000f01','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','EPC_QUOTE','k1','q.pdf','application/pdf',100,repeat('a',64),'aaaaaaaa-0000-0000-0000-0000000000a4'),
 ('aaaaaaaa-0000-0000-0000-000000000f02','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','EPC_QUOTE','k2','q2.pdf','application/pdf',100,repeat('b',64),'aaaaaaaa-0000-0000-0000-0000000000a4');
INSERT INTO epc_partners(id,tenant_id,name) VALUES ('aaaaaaaa-0000-0000-0000-000000000e01','aaaaaaaa-0000-0000-0000-000000000000','EPC One');
INSERT INTO assessments(id,tenant_id,case_id,version,method,inputs,outputs,recommendation_status,recommended_code,created_by) VALUES
 ('aaaaaaaa-0000-0000-0000-00000000a501','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1',1,'MANUAL','{}','{}','RECOMMENDED','RESI-S3-B5','aaaaaaaa-0000-0000-0000-0000000000a4'),
 ('aaaaaaaa-0000-0000-0000-00000000a502','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1',2,'MANUAL','{}','{}','PENDING_TECHNICAL_DATA',NULL,'aaaaaaaa-0000-0000-0000-0000000000a4');
INSERT INTO quotes(id,tenant_id,case_id,version,epc_partner_id,document_id,assessment_id,system_desc,equipment_inr,installation_inr,gst_inr,valid_until,uploaded_by) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000a01','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1',1,'aaaaaaaa-0000-0000-0000-000000000e01','aaaaaaaa-0000-0000-0000-000000000f01','aaaaaaaa-0000-0000-0000-00000000a501','3 kWp + 5 kWh',200000,20000,20000,'2026-10-21','aaaaaaaa-0000-0000-0000-0000000000a4');
INSERT INTO offers(id,tenant_id,case_id,quote_id,version,content,status,created_by) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000b01','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-000000000a01',1,'{}','ACCEPTED','aaaaaaaa-0000-0000-0000-0000000000a4');
INSERT INTO otp_challenges(id,tenant_id,case_id,offer_id,purpose,mobile_e164,code_hash,status,expires_at,triggered_by,idempotency_key) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000c01','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-000000000b01','ACCEPTANCE','+919876543210','h','VERIFIED',now()+interval '10 min','aaaaaaaa-0000-0000-0000-0000000000a4','k-1');
INSERT INTO files(id,tenant_id,file_no,case_id,accepted_quote_id,quote_version,accepted_total_inr,otp_challenge_id,accepted_at) VALUES
 ('aaaaaaaa-0000-0000-0000-00000000f11e','aaaaaaaa-0000-0000-0000-000000000000','F-1','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-000000000a01',1,240000,'aaaaaaaa-0000-0000-0000-000000000c01','2026-09-21 12:00+05:30');
INSERT INTO financing_decisions(id,tenant_id,case_id,file_id,financier_id,attempt_no,status) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000d01','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-00000000f11e','aaaaaaaa-0000-0000-0000-0000000000b1',1,'SANCTIONED');
INSERT INTO disbursements(tenant_id,case_id,decision_id,visible_to,disbursed_on,amount_inr,recorded_by) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-000000000d01','ECOFY_ADMIN','2026-09-20',200000,'aaaaaaaa-0000-0000-0000-0000000000a1');

-- ------------------------------------------------------------ checks
DO $$ DECLARE bad text; BEGIN   -- T01 RLS on every table
  SELECT string_agg(c.relname, ', ') INTO bad FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'T01 FAIL: tables without RLS: %', bad; END IF;
END $$;

DO $$ DECLARE bad text; BEGIN   -- T02 tenant_id on every table except tenants
  SELECT string_agg(c.relname, ', ') INTO bad FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> 'tenants'
    AND NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped);
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'T02 FAIL: tables without tenant_id: %', bad; END IF;
END $$;

DO $$ BEGIN   -- T03 duplicate open case for the same customer is blocked
  BEGIN
    INSERT INTO cases(tenant_id,customer_id,segment,source,owner_org_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000c1','RESI','ECOFY_UPLOAD','aaaaaaaa-0000-0000-0000-0000000000e1');
    RAISE EXCEPTION 'T03 FAIL: duplicate open case allowed';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

DO $$ BEGIN   -- T04 invalid mobile is blocked
  BEGIN
    INSERT INTO customers(tenant_id,full_name,mobile_e164,customer_type,address,city,state,pincode,consent_obtained,consent_date,consent_source) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','X','+915876543210','INDIVIDUAL','a','b','c','122001',true,'2026-09-15','CALL');
    RAISE EXCEPTION 'T04 FAIL: bad mobile allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

DO $$ BEGIN   -- T05 closing without a reason is blocked
  BEGIN
    UPDATE cases SET stage = 'CLOSED' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000d2';
    RAISE EXCEPTION 'T05 FAIL: close without reason allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

DO $$ DECLARE n int; f1 boolean; f2 boolean; BEGIN   -- T06 caller scope + hidden amount + within-limit
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a4','ITARANG_CALLER');
  SELECT count(*) INTO n FROM cases;               IF n <> 1 THEN RAISE EXCEPTION 'T06 FAIL: caller sees % cases', n; END IF;
  SELECT count(*) INTO n FROM eligibility_values;  IF n <> 0 THEN RAISE EXCEPTION 'T06 FAIL: caller sees eligible amount'; END IF;
  SELECT count(*) INTO n FROM v_case_ageing;       IF n <> 1 THEN RAISE EXCEPTION 'T06 FAIL: ageing view leaks % cases', n; END IF;
  f1 := offer_within_limit('aaaaaaaa-0000-0000-0000-0000000000d1', 240000);
  f2 := offer_within_limit('aaaaaaaa-0000-0000-0000-0000000000d1', 260000);
  IF NOT f1 OR f2 THEN RAISE EXCEPTION 'T06 FAIL: within-limit wrong (% / %)', f1, f2; END IF;
END $$;

DO $$ DECLARE v int; BEGIN   -- T07 Ecofy Admin reads its eligible amount
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a1','ECOFY_ADMIN');
  SELECT max_eligible_inr INTO v FROM eligibility_values;
  IF v IS DISTINCT FROM 250000 THEN RAISE EXCEPTION 'T07 FAIL: Ecofy Admin cannot read amount'; END IF;
END $$;

DO $$ DECLARE n int; BEGIN   -- T08 seat cap holds
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a3','ITARANG_ADMIN');
  UPDATE seat_limits SET seats_used = seats_used + 1 WHERE role = 'ECOFY_USER' AND seats_used < seat_limit; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'T08 FAIL: first seat not added'; END IF;
  UPDATE seat_limits SET seats_used = seats_used + 1 WHERE role = 'ECOFY_USER' AND seats_used < seat_limit; GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'T08 FAIL: seat added beyond cap'; END IF;
END $$;

DO $$ BEGIN   -- T09 audit_log cannot be edited by the app
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a3','ITARANG_ADMIN');
  INSERT INTO audit_log(tenant_id,actor_id,action,entity_type,entity_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a3','test','case','x');
  BEGIN
    UPDATE audit_log SET action = 'tampered';
    RAISE EXCEPTION 'T09 FAIL: audit_log editable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

DO $$ DECLARE n int; BEGIN   -- T10 tenant isolation, including child tables
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a3','ITARANG_ADMIN');
  SELECT count(*) INTO n FROM import_rows;     IF n <> 0 THEN RAISE EXCEPTION 'T10 FAIL: import_rows of other tenant visible'; END IF;
  SELECT count(*) INTO n FROM calc_systems;    IF n <> 0 THEN RAISE EXCEPTION 'T10 FAIL: calc_systems of other tenant visible'; END IF;
  SELECT count(*) INTO n FROM user_sessions;   IF n <> 0 THEN RAISE EXCEPTION 'T10 FAIL: user_sessions of other tenant visible'; END IF;
  SELECT count(*) INTO n FROM tenants;         IF n <> 1 THEN RAISE EXCEPTION 'T10 FAIL: sees % tenants', n; END IF;
  SELECT count(*) INTO n FROM tenant_domains;  IF n <> 1 THEN RAISE EXCEPTION 'T10 FAIL: sees % domains', n; END IF;
  SELECT count(*) INTO n FROM calc_releases;   IF n <> 1 THEN RAISE EXCEPTION 'T10 FAIL: sees % releases', n; END IF;
END $$;

DO $$ DECLARE t uuid; n int; BEGIN   -- T11 host lookup works before a tenant is set; nothing else does
  PERFORM pg_temp.as_app(NULL, NULL, NULL);
  t := resolve_tenant('TEST.example.com');
  IF t IS DISTINCT FROM 'aaaaaaaa-0000-0000-0000-000000000000'::uuid THEN RAISE EXCEPTION 'T11 FAIL: resolver returned %', t; END IF;
  SELECT count(*) INTO n FROM tenant_domains; IF n <> 0 THEN RAISE EXCEPTION 'T11 FAIL: domains readable without tenant'; END IF;
  SELECT count(*) INTO n FROM cases;          IF n <> 0 THEN RAISE EXCEPTION 'T11 FAIL: cases readable without tenant'; END IF;
END $$;

DO $$ BEGIN   -- T12 app cannot create tenants
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a3','ITARANG_ADMIN');
  BEGIN
    INSERT INTO tenants(code,name) VALUES ('X','X');
    RAISE EXCEPTION 'T12 FAIL: app created a tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

DO $$ BEGIN   -- T13 appointment rules
  BEGIN
    INSERT INTO appointments(tenant_id,case_id,meeting_type,scheduled_at,status,actual_at,booking_remarks,created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','SITE_VISIT',now(),'COMPLETED',now(),'agenda','aaaaaaaa-0000-0000-0000-0000000000a4');
    RAISE EXCEPTION 'T13 FAIL: completed without meeting remarks';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO appointments(tenant_id,case_id,meeting_type,scheduled_at,status,created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','PHONE',now(),'NO_SHOW','aaaaaaaa-0000-0000-0000-0000000000a4');
    RAISE EXCEPTION 'T13 FAIL: no-show without reason';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO appointments(tenant_id,case_id,meeting_type,scheduled_at,status,actual_at,booking_remarks,meeting_remarks,created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1','SITE_VISIT',now()-interval '1 hour','COMPLETED',now(),'agenda','Wants 5 kWh','aaaaaaaa-0000-0000-0000-0000000000a4');
END $$;

DO $$ DECLARE n int; BEGIN   -- T14 Ecofy scope: not a case financed elsewhere, until Ecofy becomes its financier
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a1','ECOFY_ADMIN');
  SELECT count(*) INTO n FROM cases; IF n <> 1 THEN RAISE EXCEPTION 'T14 FAIL: Ecofy Admin sees % cases', n; END IF;
END $$;
UPDATE cases SET financier_id = 'aaaaaaaa-0000-0000-0000-0000000000b1' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000d2';
DO $$ DECLARE n int; BEGIN
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a1','ECOFY_ADMIN');
  SELECT count(*) INTO n FROM cases; IF n <> 2 THEN RAISE EXCEPTION 'T14 FAIL: after routing Ecofy Admin sees % cases', n; END IF;
END $$;

DO $$ DECLARE n int; BEGIN   -- T15 payout amounts follow the financier's role
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a3','ITARANG_ADMIN');
  SELECT count(*) INTO n FROM disbursements; IF n <> 0 THEN RAISE EXCEPTION 'T15 FAIL: iTarang Admin sees Ecofy payout'; END IF;
END $$;
DO $$ DECLARE n int; BEGIN
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a1','ECOFY_ADMIN');
  SELECT count(*) INTO n FROM disbursements; IF n <> 1 THEN RAISE EXCEPTION 'T15 FAIL: Ecofy Admin cannot see its payout'; END IF;
END $$;

DO $$ BEGIN   -- T16 KYC document types blocked; look-alikes allowed
  BEGIN
    INSERT INTO list_items(tenant_id,list_code,code,label) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','document_type','PAN_CARD','PAN card');
    RAISE EXCEPTION 'T16 FAIL: PAN type allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO list_items(tenant_id,list_code,code,label) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','document_type','BANK_STMT','Bank statement');
    RAISE EXCEPTION 'T16 FAIL: bank statement type allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO list_items(tenant_id,list_code,code,label) VALUES
    ('aaaaaaaa-0000-0000-0000-000000000000','document_type','PANEL_PHOTO','Solar panel photo'),
    ('aaaaaaaa-0000-0000-0000-000000000000','document_type','ELECTRICITY_BILL','Electricity bill');
END $$;

DO $$ BEGIN   -- T17 a case with a File never reopens; a linked new case is allowed
  UPDATE cases SET stage = 'CLOSED', closure_reason = 'WITHDRAWN' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000d1';
  BEGIN
    UPDATE cases SET stage = 'S0' WHERE id = 'aaaaaaaa-0000-0000-0000-0000000000d1';
    RAISE EXCEPTION 'T17 FAIL: case with a File reopened';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO cases(tenant_id,customer_id,segment,source,owner_org_id,previous_case_id) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000c1','RESI','ECOFY_UPLOAD','aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-0000000000d1');
END $$;

DO $$ BEGIN   -- T18 idempotency keys usable by the app
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a4','ITARANG_CALLER');
  INSERT INTO idempotency_keys(tenant_id,key,user_id,route,request_hash) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','otp-1','aaaaaaaa-0000-0000-0000-0000000000a4','POST /offers/x/otp',repeat('b',64));
END $$;

DO $$ BEGIN   -- T19 recommendation status and code must agree
  BEGIN
    INSERT INTO assessments(tenant_id,case_id,version,method,inputs,outputs,recommendation_status,created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2',1,'MANUAL','{}','{}','RECOMMENDED','aaaaaaaa-0000-0000-0000-0000000000a3');
    RAISE EXCEPTION 'T19 FAIL: RECOMMENDED without a system';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO assessments(tenant_id,case_id,version,method,inputs,outputs,recommendation_status,recommended_code,created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2',1,'MANUAL','{}','{}','PENDING_TECHNICAL_DATA','X','aaaaaaaa-0000-0000-0000-0000000000a3');
    RAISE EXCEPTION 'T19 FAIL: PENDING with a system';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

DO $$ BEGIN   -- T20 earned rule 3: provisional quote with a reason when power data is pending
  UPDATE quotes SET status = 'SUPERSEDED' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000a01';
  BEGIN
    INSERT INTO quotes(tenant_id,case_id,version,epc_partner_id,document_id,assessment_id,system_desc,equipment_inr,installation_inr,gst_inr,valid_until,uploaded_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1',2,'aaaaaaaa-0000-0000-0000-000000000e01','aaaaaaaa-0000-0000-0000-000000000f02','aaaaaaaa-0000-0000-0000-00000000a502','TBD',1,1,1,'2026-10-21','aaaaaaaa-0000-0000-0000-0000000000a4');
    RAISE EXCEPTION 'T20 FAIL: non-provisional quote on pending assessment';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO quotes(tenant_id,case_id,version,epc_partner_id,document_id,assessment_id,provisional,system_desc,equipment_inr,installation_inr,gst_inr,valid_until,uploaded_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1',2,'aaaaaaaa-0000-0000-0000-000000000e01','aaaaaaaa-0000-0000-0000-000000000f02','aaaaaaaa-0000-0000-0000-00000000a502',true,'TBD',1,1,1,'2026-10-21','aaaaaaaa-0000-0000-0000-0000000000a4');
    RAISE EXCEPTION 'T20 FAIL: provisional quote without reason';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO quotes(tenant_id,case_id,version,epc_partner_id,document_id,assessment_id,provisional,provisional_reason,system_desc,equipment_inr,installation_inr,gst_inr,valid_until,uploaded_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d1',2,'aaaaaaaa-0000-0000-0000-000000000e01','aaaaaaaa-0000-0000-0000-000000000f02','aaaaaaaa-0000-0000-0000-00000000a502',true,'Customer wants a price before sharing the bill','TBD',1,1,1,'2026-10-21','aaaaaaaa-0000-0000-0000-0000000000a4');
END $$;

DO $$ BEGIN   -- T21 trusted device needs an expiry; other tenant's devices invisible
  BEGIN
    INSERT INTO trusted_devices(tenant_id,user_id,device_hash,status) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a4',repeat('c',64),'TRUSTED');
    RAISE EXCEPTION 'T21 FAIL: trusted device without expiry';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
INSERT INTO trusted_devices(tenant_id,user_id,device_hash,status,trusted_until) VALUES ('bbbbbbbb-0000-0000-0000-000000000000','bbbbbbbb-0000-0000-0000-0000000000a1',repeat('d',64),'TRUSTED',now()+interval '30 days');
DO $$ DECLARE n int; BEGIN
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a3','ITARANG_ADMIN');
  SELECT count(*) INTO n FROM trusted_devices; IF n <> 0 THEN RAISE EXCEPTION 'T21 FAIL: other tenant device visible'; END IF;
END $$;

DO $$ BEGIN   -- T22 standard systems: usable capacity cannot exceed nominal
  BEGIN
    INSERT INTO calc_systems(tenant_id,release_id,system_code,system_name,for_resi,for_ess,for_ci,system_type,battery_capacity_kwh,usable_capacity_kwh,inverter_kva,inverter_type,phase,solar_kwp,equipment_price_min_inr,equipment_price_max_inr,installation_price_min_inr,installation_price_max_inr,gst_pct,price_updated_on)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-00000000ca01','A-1','A',true,false,false,'STORAGE_ONLY',5,6,5,'OFF_GRID','SINGLE',0,100,200,10,20,12,'2026-09-01');
    RAISE EXCEPTION 'T22 FAIL: usable > nominal allowed';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

DO $$ BEGIN   -- T23 one published calculator release per tenant
  BEGIN
    INSERT INTO calc_releases(tenant_id,version,status,params,created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000',2,'PUBLISHED','{}','aaaaaaaa-0000-0000-0000-0000000000a3');
    RAISE EXCEPTION 'T23 FAIL: two published releases';
  EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;

DO $$ BEGIN   -- T24 import commit needs the consent confirmation
  BEGIN
    INSERT INTO import_batches(tenant_id,uploaded_by,file_key,file_name,status) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a1','k','a.xlsx','COMMITTED');
    RAISE EXCEPTION 'T24 FAIL: commit without consent confirmation';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- ------------------------------------------------------------ File lineage fixture on case d2 (as owner)
INSERT INTO documents(id,tenant_id,case_id,type_code,s3_key,file_name,mime_type,size_bytes,sha256,uploaded_by) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000f03','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','EPC_QUOTE','k3','q3.pdf','application/pdf',100,repeat('e',64),'aaaaaaaa-0000-0000-0000-0000000000a3');
INSERT INTO assessments(id,tenant_id,case_id,version,method,inputs,outputs,recommendation_status,recommended_code,created_by) VALUES
 ('aaaaaaaa-0000-0000-0000-00000000a503','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2',1,'MANUAL','{}','{}','RECOMMENDED','RESI-S3-B5','aaaaaaaa-0000-0000-0000-0000000000a3');
INSERT INTO quotes(id,tenant_id,case_id,version,epc_partner_id,document_id,assessment_id,system_desc,equipment_inr,installation_inr,gst_inr,valid_until,status,uploaded_by) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000a03','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2',1,'aaaaaaaa-0000-0000-0000-000000000e01','aaaaaaaa-0000-0000-0000-000000000f03','aaaaaaaa-0000-0000-0000-00000000a503','5 kWh',100000,10000,10000,'2026-10-21','ACTIVE','aaaaaaaa-0000-0000-0000-0000000000a3'),
 ('aaaaaaaa-0000-0000-0000-000000000a04','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2',2,'aaaaaaaa-0000-0000-0000-000000000e01','aaaaaaaa-0000-0000-0000-000000000f03','aaaaaaaa-0000-0000-0000-00000000a503','4 kWh',90000,10000,9000,'2026-10-21','SUPERSEDED','aaaaaaaa-0000-0000-0000-0000000000a3');
INSERT INTO offers(id,tenant_id,case_id,quote_id,version,content,status,created_by) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000b03','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a03',1,'{}','SENT','aaaaaaaa-0000-0000-0000-0000000000a3'),
 ('aaaaaaaa-0000-0000-0000-000000000b04','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a04',2,'{}','SUPERSEDED','aaaaaaaa-0000-0000-0000-0000000000a3');
INSERT INTO otp_challenges(id,tenant_id,case_id,offer_id,purpose,mobile_e164,code_hash,status,expires_at,triggered_by,idempotency_key) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000c03','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000b03','ACCEPTANCE','+919812345670','h','VERIFIED',now()+interval '10 min','aaaaaaaa-0000-0000-0000-0000000000a3','k-3'),
 ('aaaaaaaa-0000-0000-0000-000000000c04','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000b03','ACCEPTANCE','+919812345670','h','SENT',now()+interval '10 min','aaaaaaaa-0000-0000-0000-0000000000a3','k-4'),
 ('aaaaaaaa-0000-0000-0000-000000000c05','aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000b04','ACCEPTANCE','+919812345670','h','VERIFIED',now()+interval '10 min','aaaaaaaa-0000-0000-0000-0000000000a3','k-5');

DO $$ BEGIN   -- T25 File lineage: the billable event must match its quote and its verified OTP
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a3','ITARANG_ADMIN');
  BEGIN   -- quote from another case
    INSERT INTO files(tenant_id,file_no,case_id,accepted_quote_id,quote_version,accepted_total_inr,otp_challenge_id,accepted_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','F-2','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a01',1,240000,'aaaaaaaa-0000-0000-0000-000000000c03','2026-09-21 12:00+05:30');
    RAISE EXCEPTION 'T25 FAIL: File on another case''s quote';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN   -- wrong quote version
    INSERT INTO files(tenant_id,file_no,case_id,accepted_quote_id,quote_version,accepted_total_inr,otp_challenge_id,accepted_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','F-2','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a03',2,120000,'aaaaaaaa-0000-0000-0000-000000000c03','2026-09-21 12:00+05:30');
    RAISE EXCEPTION 'T25 FAIL: wrong quote version accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN   -- wrong total
    INSERT INTO files(tenant_id,file_no,case_id,accepted_quote_id,quote_version,accepted_total_inr,otp_challenge_id,accepted_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','F-2','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a03',1,110000,'aaaaaaaa-0000-0000-0000-000000000c03','2026-09-21 12:00+05:30');
    RAISE EXCEPTION 'T25 FAIL: wrong total accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN   -- OTP not verified
    INSERT INTO files(tenant_id,file_no,case_id,accepted_quote_id,quote_version,accepted_total_inr,otp_challenge_id,accepted_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','F-2','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a03',1,120000,'aaaaaaaa-0000-0000-0000-000000000c04','2026-09-21 12:00+05:30');
    RAISE EXCEPTION 'T25 FAIL: File on an unverified OTP';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN   -- OTP confirmed an offer on a different quote
    INSERT INTO files(tenant_id,file_no,case_id,accepted_quote_id,quote_version,accepted_total_inr,otp_challenge_id,accepted_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','F-2','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a03',1,120000,'aaaaaaaa-0000-0000-0000-000000000c05','2026-09-21 12:00+05:30');
    RAISE EXCEPTION 'T25 FAIL: OTP chain points at another quote';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN   -- OTP from another case
    INSERT INTO files(tenant_id,file_no,case_id,accepted_quote_id,quote_version,accepted_total_inr,otp_challenge_id,accepted_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','F-2','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a03',1,120000,'aaaaaaaa-0000-0000-0000-000000000c01','2026-09-21 12:00+05:30');
    RAISE EXCEPTION 'T25 FAIL: OTP from another case';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  INSERT INTO files(id,tenant_id,file_no,case_id,accepted_quote_id,quote_version,accepted_total_inr,otp_challenge_id,accepted_at) VALUES ('aaaaaaaa-0000-0000-0000-00000000f12e','aaaaaaaa-0000-0000-0000-000000000000','F-2','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a03',1,120000,'aaaaaaaa-0000-0000-0000-000000000c03','2026-09-21 12:00+05:30');
  BEGIN   -- a File is never edited
    UPDATE files SET accepted_total_inr = 1 WHERE id = 'aaaaaaaa-0000-0000-0000-00000000f12e';
    RAISE EXCEPTION 'T25 FAIL: File editable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN   -- quote terms never change after upload
    UPDATE quotes SET equipment_inr = 1 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000a03';
    RAISE EXCEPTION 'T25 FAIL: quote amount editable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  UPDATE quotes SET status = 'ACCEPTED' WHERE id = 'aaaaaaaa-0000-0000-0000-000000000a03';   -- status still changes
END $$;

DO $$ BEGIN   -- T26 the rest of the chain stays on one case
  PERFORM pg_temp.as_app('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000a3','ITARANG_ADMIN');
  BEGIN
    INSERT INTO offers(tenant_id,case_id,quote_id,version,content,status,created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-000000000a01',3,'{}','SUPERSEDED','aaaaaaaa-0000-0000-0000-0000000000a3');
    RAISE EXCEPTION 'T26 FAIL: offer on another case''s quote';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO financing_decisions(tenant_id,case_id,file_id,financier_id,attempt_no) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-00000000f11e','aaaaaaaa-0000-0000-0000-0000000000b1',1);
    RAISE EXCEPTION 'T26 FAIL: decision on another case''s File';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN
    INSERT INTO file_acceptances(tenant_id,case_id,file_id,kind,offer_id,otp_challenge_id,accepted_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-00000000f12e','INITIAL','aaaaaaaa-0000-0000-0000-000000000b04','aaaaaaaa-0000-0000-0000-000000000c05',now());
    RAISE EXCEPTION 'T26 FAIL: INITIAL acceptance not the File''s own OTP';
  EXCEPTION WHEN check_violation THEN NULL; END;
  INSERT INTO file_acceptances(tenant_id,case_id,file_id,kind,offer_id,otp_challenge_id,accepted_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','aaaaaaaa-0000-0000-0000-0000000000d2','aaaaaaaa-0000-0000-0000-00000000f12e','INITIAL','aaaaaaaa-0000-0000-0000-000000000b03','aaaaaaaa-0000-0000-0000-000000000c03',now());
END $$;

\echo 'ALL 26 SCHEMA CHECKS PASSED'
