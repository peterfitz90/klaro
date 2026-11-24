-- Tests for 0003_fpa_actuals_budget_variance.sql. Run AFTER the migration INSIDE ONE TRANSACTION
-- (db/bundle.mjs builds db/out/test_0003.sql: BEGIN; 0003; this file). 0001 is already applied on the
-- database. The report block at the end always raises, so everything, including the fpa_test helpers
-- and every fixture row, rolls back.
-- Every access check runs as a real role (SET LOCAL ROLE anon / authenticated / service_role) with
-- real JWT claims in request.jwt.claims. Fixtures are made up. Expect "0 failure(s), N pass(es)".

CREATE SCHEMA fpa_test;
CREATE TABLE fpa_test.results (n serial, label text, pass boolean, detail text);
CREATE FUNCTION fpa_test.as_user(p_who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  IF p_who IN ('anon', 'service_role') THEN
    PERFORM set_config('request.jwt.claims', json_build_object('role', p_who)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', p_who);
  ELSIF p_who = 'authenticated' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"authenticated"}', true);
    EXECUTE 'SET LOCAL ROLE authenticated';
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', p_who, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
  END IF;
END $$;
CREATE FUNCTION fpa_test.as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN EXECUTE 'RESET ROLE'; PERFORM set_config('request.jwt.claims', '', true); END $$;
-- Runs a statement as the current role and always undoes it. Returns 'ok:<rows>' or the SQLSTATE.
CREATE FUNCTION fpa_test.attempt(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_n bigint;
BEGIN
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0099', MESSAGE = v_n::text;
  EXCEPTION
    WHEN SQLSTATE 'P0099' THEN RETURN 'ok:' || SQLERRM;
    WHEN others THEN RETURN SQLSTATE;
  END;
END $$;
-- Runs a statement as the current role and keeps it. Returns 'ok' or 'SQLSTATE: message'.
CREATE FUNCTION fpa_test.try_msg(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN EXECUTE p_sql; RETURN 'ok'; EXCEPTION WHEN others THEN RETURN SQLSTATE || ': ' || SQLERRM; END $$;
-- A single text value as the current role, or the SQLSTATE.
CREATE FUNCTION fpa_test.val(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; BEGIN EXECUTE p_sql INTO v; RETURN coalesce(v, 'null'); EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION fpa_test.check(p_pass boolean, p_label text, p_detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO fpa_test.results (label, pass, detail) VALUES (p_label, coalesce(p_pass, false), p_detail); $$;
-- Injected failures for the atomicity tests, switched on by a setting.
CREATE FUNCTION fpa_test.fail_sync_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('fpa_test.fail_sync_run', true) = 'on' THEN RAISE EXCEPTION 'injected failure writing the sync log'; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION fpa_test.fail_actual_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_code = current_setting('fpa_test.fail_account', true) THEN RAISE EXCEPTION 'injected failure at account %', NEW.account_code; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_test_fail BEFORE INSERT ON fpa.sync_runs FOR EACH ROW EXECUTE FUNCTION fpa_test.fail_sync_run();
CREATE TRIGGER zz_test_fail BEFORE INSERT ON fpa.actuals_monthly FOR EACH ROW EXECUTE FUNCTION fpa_test.fail_actual_row();
-- One import row.
CREATE FUNCTION fpa_test.r(p_code text, p_month text, p_amount text, p_name text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('account_code', p_code, 'month', p_month, 'amount', p_amount, 'account_name', p_name)); $$;
-- One variance cell as 'actual|budget|variance|pct(4 dp)|favourable'.
CREATE FUNCTION fpa_test.cell(p_entity uuid, p_version uuid, p_key text, p_month date) RETURNS text LANGUAGE sql AS $$
  SELECT format('%s|%s|%s|%s|%s', coalesce(v.actual::text, 'null'), coalesce(v.budget::text, 'null'), coalesce(v.variance::text, 'null'),
                coalesce(round(v.variance_pct, 4)::text, 'null'), coalesce(v.favourable::text, 'null'))
    FROM fpa.variance(p_entity, p_version, DATE '2025-01-01', DATE '2025-05-01') v WHERE v.line_key = p_key AND v.month = p_month; $$;
GRANT USAGE ON SCHEMA fpa_test TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA fpa_test TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA fpa_test TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fpa_test TO anon, authenticated, service_role;

DO $test$
DECLARE
  v_who constant text[] := ARRAY['user_ownerA', 'user_editorA', 'user_viewerA', 'user_inactiveA', 'user_outsider', 'user_ownerB', 'anon', 'service_role'];
  e_edit constant text[] := ARRAY['ok:1', 'ok:1', 'PT403', 'PT403', 'PT403', 'PT403', '42501', '42501'];
  e_none constant text[] := ARRAY['42501', '42501', '42501', '42501', '42501', '42501', '42501', '42501'];
  v_cases constant jsonb := $rc$__ROUNDING_CASES__$rc$::jsonb;
  v_ea uuid; v_eb uuid; v_pa uuid; v_pb uuid; v_ca uuid; v_ca2 uuid; v_ca3 uuid; v_cb uuid;
  v_va uuid; v_sa uuid; v_sa2 uuid; v_vb uuid; v_vf uuid; v_vn uuid;
  v_rows jsonb; v_res jsonb; v_got text; v_exp text; v_n bigint; v_n2 bigint; v_t text; v_sum numeric; v_sync timestamptz;
  v_case jsonb; i int; j int; v_sql text; v_file1 jsonb; v_file2 jsonb;
BEGIN
  -- ── Fixtures ──
  PERFORM fpa_test.as_user('user_ownerA');
  v_ea := fpa.create_entity('Alpha Test Ltd', 'IE', 'EUR', 1::smallint);
  PERFORM fpa.add_member(v_ea, 'user_editorA', 'editor');
  PERFORM fpa.add_member(v_ea, 'user_viewerA', 'viewer');
  PERFORM fpa.add_member(v_ea, 'user_inactiveA', 'editor');
  PERFORM fpa.set_member(v_ea, 'user_inactiveA', 'editor', false);
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_ea, 'csv') RETURNING id INTO v_ca;
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_ea, 'ledgrly') RETURNING id INTO v_ca2;
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_ea, 'csv') RETURNING id INTO v_ca3;
  UPDATE fpa.connections SET status = 'disabled' WHERE id = v_ca3;
  SELECT p.id INTO v_pa FROM fpa.plans p WHERE p.entity_id = v_ea;
  PERFORM fpa_test.as_user('user_ownerB');
  v_eb := fpa.create_entity('Bravo Test Ltd', 'UK', 'GBP', 1::smallint);
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_eb, 'csv') RETURNING id INTO v_cb;
  SELECT p.id INTO v_pb FROM fpa.plans p WHERE p.entity_id = v_eb;
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_pb, 'budget', 'Bravo budget') RETURNING id INTO v_vb;
  PERFORM fpa_test.check(v_ea IS NOT NULL AND v_eb IS NOT NULL AND v_ca IS NOT NULL AND v_cb IS NOT NULL AND v_pa IS NOT NULL, 'fixtures created through the API paths');

  -- ── 1. Plan-line list: exact seed, readable by signed-in users only, writable by no API role ──
  PERFORM fpa_test.as_postgres();
  SELECT string_agg(format('%s:%s:%s:%s:%s:%s:%s', d.key, d.label, d.kind, d.sort_order, d.display_sign, d.mappable::text, d.budgetable::text), ',' ORDER BY d.sort_order) INTO v_got FROM fpa.plan_line_defs d;
  PERFORM fpa_test.check(v_got = 'revenue:Revenue:income:10:-1:true:true,cost_of_sales:Cost of sales:cost:20:1:true:true,gross_profit:Gross profit:calculated:30:-1:false:false,'
    'payroll:Payroll:cost:40:1:true:true,marketing:Marketing:cost:50:1:true:true,premises:Rent and premises:cost:60:1:true:true,'
    'other_operating:Other operating costs:cost:70:1:true:true,operating_profit:Operating profit:calculated:80:-1:false:false,'
    'interest:Interest:cost:90:1:true:true,tax:Tax:cost:100:1:true:true,net_profit:Net profit:calculated:110:-1:false:false,'
    'unmapped:Unmapped:unmapped:120:1:false:false,excluded:Not in the P&L (excluded):excluded:130:1:true:false', 'plan_line_defs holds exactly the agreed list', v_got);
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.val('SELECT count(*)::text FROM fpa.plan_line_defs');
    PERFORM fpa_test.check(v_got = CASE WHEN i <= 6 THEN '13' ELSE '42501' END, 'plan_line_defs read as ' || v_who[i], v_got);
    v_got := fpa_test.attempt('UPDATE fpa.plan_line_defs SET label = ''X'' WHERE key = ''revenue''');
    PERFORM fpa_test.check(v_got = '42501', 'plan_line_defs update refused as ' || v_who[i], v_got);
    v_got := fpa_test.attempt('INSERT INTO fpa.plan_line_defs (key, label, kind, sort_order, display_sign) VALUES (''x'', ''X'', ''cost'', 999, 1)');
    PERFORM fpa_test.check(v_got = '42501', 'plan_line_defs insert refused as ' || v_who[i], v_got);
  END LOOP;

  -- ── 2. import_actuals: who may call it ──
  v_rows := jsonb_build_array(fpa_test.r('4000', '2025-01-01', '-1.00'));
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.attempt(format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca, v_rows, 'perm.csv'));
    PERFORM fpa_test.check(v_got = e_edit[i], 'import_actuals into entity A as ' || v_who[i], v_got);
  END LOOP;
  PERFORM fpa_test.as_user('authenticated');
  v_got := fpa_test.attempt(format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca, v_rows, 'perm.csv'));
  PERFORM fpa_test.check(v_got = 'PT401', 'import_actuals with no user id is refused (PT401)', v_got);
  PERFORM fpa_test.as_user('user_ownerB');
  v_got := fpa_test.attempt(format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_eb, v_ca, v_rows, 'cross.csv'));
  PERFORM fpa_test.check(v_got = 'PT404', 'cross-entity: owner B cannot import into A''s connection through B''s entity', v_got);
  PERFORM fpa_test.as_user('user_ownerA');
  v_got := fpa_test.attempt(format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_cb, v_rows, 'cross.csv'));
  PERFORM fpa_test.check(v_got = 'PT404', 'cross-entity: owner A cannot import into B''s connection through A''s entity', v_got);

  -- ── 3. First import, then a re-import that replaces whole months ──
  v_file1 := jsonb_build_array(
    fpa_test.r('4000', '2025-01-01', '-10000.00', 'Sales'), fpa_test.r('4000', '2025-02-01', '-12000.00', 'Sales'), fpa_test.r('4000', '2025-03-01', '-11000.00', 'Sales'),
    fpa_test.r('5000', '2025-01-01', '4000.00', 'Purchases'), fpa_test.r('5000', '2025-02-01', '4500.00', 'Purchases'), fpa_test.r('5000', '2025-03-01', '4200.00', 'Purchases'),
    fpa_test.r('6000', '2025-01-01', '3000.00', 'Wages'), fpa_test.r('6000', '2025-02-01', '3000.00', 'Wages'), fpa_test.r('6000', '2025-03-01', '3100.00', 'Wages'),
    fpa_test.r('7000', '2025-01-01', '1000.00', 'Rent'), fpa_test.r('7000', '2025-02-01', '1000.00', 'Rent'), fpa_test.r('7000', '2025-03-01', '1000.00', 'Rent'),
    fpa_test.r('8000', '2025-01-01', '250.00', 'Sundry'), fpa_test.r('8000', '2025-02-01', '300.00', 'Sundry'), fpa_test.r('8000', '2025-03-01', '50.00', 'Sundry'),
    fpa_test.r('1200', '2025-01-01', '1750.00', 'Bank'), fpa_test.r('1200', '2025-02-01', '3200.00', 'Bank'), fpa_test.r('1200', '2025-03-01', '2650.00', 'Bank'));
  PERFORM fpa_test.as_user('user_editorA');
  v_res := fpa.import_actuals(v_ea, v_ca, v_file1, 'tb-2025-q1.csv');
  PERFORM fpa_test.check(v_res ->> 'rows_added' = '18' AND v_res ->> 'rows_removed' = '0' AND v_res -> 'months_replaced' = '["2025-01-01","2025-02-01","2025-03-01"]'::jsonb
    AND v_res ->> 'actuals_through' = '2025-03-01', 'first import: 18 added, 0 removed, 3 months, through 2025-03', v_res::text);
  PERFORM fpa_test.as_user('user_ownerB');
  PERFORM fpa.import_actuals(v_eb, v_cb, jsonb_build_array(fpa_test.r('4000', '2025-01-01', '-500.00')), 'bravo.csv');

  -- Amounts as JSON numbers and padded text are accepted and stored exactly.
  v_file2 := jsonb_build_array(
    fpa_test.r('4000', '2025-02-01', '-12500.00', 'Sales'), jsonb_build_object('account_code', '5000', 'month', '2025-02-01', 'amount', 4500),
    jsonb_build_object('account_code', ' 6000 ', 'month', '2025-02-01', 'amount', 3000.5), fpa_test.r('1200', '2025-02-01', ' 5000.00 '),
    fpa_test.r('4000', '2025-04-01', '-9000.00', 'Sales'), fpa_test.r('5000', '2025-04-01', '3900.00'));
  PERFORM fpa_test.as_user('user_editorA');
  v_res := fpa.import_actuals(v_ea, v_ca, v_file2, 'tb-feb-apr.csv');
  PERFORM fpa_test.check(v_res ->> 'rows_added' = '6' AND v_res ->> 'rows_removed' = '6' AND v_res -> 'months_replaced' = '["2025-02-01","2025-04-01"]'::jsonb
    AND v_res ->> 'actuals_through' = '2025-04-01', 're-import: 6 added, 6 removed (all of February), through 2025-04', v_res::text);
  SELECT string_agg(format('%s/%s/%s', to_char(a.period, 'MM'), a.account_code, a.amount), ',' ORDER BY a.period, a.account_code) INTO v_got
    FROM fpa.actuals_monthly a WHERE a.connection_id = v_ca;
  PERFORM fpa_test.check(v_got = '01/1200/1750.00,01/4000/-10000.00,01/5000/4000.00,01/6000/3000.00,01/7000/1000.00,01/8000/250.00,'
    '02/1200/5000.00,02/4000/-12500.00,02/5000/4500.00,02/6000/3000.50,'
    '03/1200/2650.00,03/4000/-11000.00,03/5000/4200.00,03/6000/3100.00,03/7000/1000.00,03/8000/50.00,'
    '04/4000/-9000.00,04/5000/3900.00', 'whole-month replace: January and March untouched, February replaced exactly (7000 and 8000 gone, 6000 changed), April added', v_got);
  PERFORM fpa_test.check((SELECT string_agg(coalesce(a.account_name, '-'), ',' ORDER BY a.account_code) FROM fpa.actuals_monthly a WHERE a.connection_id = v_ca AND a.period = '2025-02-01')
    = '-,Sales,-,-', 'account names: kept when sent, empty when not (a re-import replaces them too)');
  PERFORM fpa_test.check((SELECT string_agg(a.account_code || a.amount, ',') FROM fpa.actuals_monthly a WHERE a.connection_id = v_cb) = '4000-500.00',
    'entity B''s actuals are untouched by entity A''s imports');
  SELECT c.last_synced_at INTO v_sync FROM fpa.connections c WHERE c.id = v_ca;
  PERFORM fpa_test.check((SELECT c.status = 'active' AND c.actuals_through = '2025-04-01' AND c.last_synced_at IS NOT NULL FROM fpa.connections c WHERE c.id = v_ca),
    'the connection is active, with actuals through 2025-04 and a last-synced time');
  PERFORM fpa_test.check((SELECT string_agg(format('%s:%s:%s:%s:%s:%s', s.run_by, s.source_name, s.months_replaced, s.rows_removed, s.rows_added, s.status), ',' ORDER BY s.rows_added DESC)
      FROM fpa.sync_runs s WHERE s.connection_id = v_ca)
    = 'user_editorA:tb-2025-q1.csv:{2025-01-01,2025-02-01,2025-03-01}:0:18:succeeded,user_editorA:tb-feb-apr.csv:{2025-02-01,2025-04-01}:6:6:succeeded',
    'sync_runs logs who, file, months replaced, rows removed and added, status');

  -- ── 4. Atomicity: a failure anywhere undoes the whole import ──
  SELECT count(*), sum(a.amount) INTO v_n, v_sum FROM fpa.actuals_monthly a WHERE a.connection_id = v_ca;
  PERFORM set_config('fpa_test.fail_sync_run', 'on', true);
  v_got := fpa_test.try_msg(format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca,
    jsonb_build_array(fpa_test.r('4000', '2025-01-01', '-1.00'), fpa_test.r('9999', '2025-05-01', '1.00')), 'fails-at-log.csv'));
  PERFORM set_config('fpa_test.fail_sync_run', 'off', true);
  PERFORM fpa_test.check(v_got LIKE '%injected failure writing the sync log%', 'atomicity: the failure at the last step (sync log) reaches the caller', v_got);
  PERFORM fpa_test.check((SELECT count(*) = v_n AND sum(a.amount) = v_sum AND count(*) FILTER (WHERE a.period = '2025-01-01') = 6 FROM fpa.actuals_monthly a WHERE a.connection_id = v_ca)
    AND (SELECT count(*) FROM fpa.sync_runs s WHERE s.connection_id = v_ca) = 2
    AND (SELECT c.last_synced_at = v_sync AND c.actuals_through = '2025-04-01' FROM fpa.connections c WHERE c.id = v_ca),
    'atomicity: after a failure at the log, January''s deleted rows are back, nothing added, log and sync fields unchanged');
  PERFORM set_config('fpa_test.fail_account', '5000', true);
  v_got := fpa_test.try_msg(format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca,
    jsonb_build_array(fpa_test.r('4000', '2025-03-01', '-1.00'), fpa_test.r('5000', '2025-03-01', '2.00'), fpa_test.r('6000', '2025-03-01', '3.00')), 'fails-midway.csv'));
  PERFORM set_config('fpa_test.fail_account', '', true);
  PERFORM fpa_test.check(v_got LIKE '%injected failure at account 5000%', 'atomicity: a failure midway through the inserts reaches the caller', v_got);
  PERFORM fpa_test.check((SELECT count(*) = v_n AND sum(a.amount) = v_sum AND count(*) FILTER (WHERE a.period = '2025-03-01') = 6 FROM fpa.actuals_monthly a WHERE a.connection_id = v_ca)
    AND (SELECT count(*) FROM fpa.sync_runs s WHERE s.connection_id = v_ca) = 2,
    'atomicity: after a failure midway, March is exactly as before (no partial month), nothing logged');

  -- ── 5. Limits and bad input: refused, nothing changes ──
  FOR v_case IN SELECT x FROM jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('l', 'rows not a list', 'rows', '{}'::jsonb, 'e', 'PT400'),
      jsonb_build_object('l', 'no rows', 'rows', '[]'::jsonb, 'e', 'PT400'),
      jsonb_build_object('l', 'a row that is not an object', 'rows', '[1]'::jsonb, 'e', 'PT400'),
      jsonb_build_object('l', 'unknown field', 'rows', jsonb_build_array(fpa_test.r('4000', '2025-01-01', '1.00') || '{"vat": 1}'), 'e', 'PT400'),
      jsonb_build_object('l', 'no account code', 'rows', '[{"month": "2025-01-01", "amount": "1.00"}]'::jsonb, 'e', 'PT400'),
      jsonb_build_object('l', 'blank account code', 'rows', jsonb_build_array(fpa_test.r('  ', '2025-01-01', '1.00')), 'e', 'PT400'),
      jsonb_build_object('l', 'account code of 65 characters', 'rows', jsonb_build_array(fpa_test.r(repeat('9', 65), '2025-01-01', '1.00')), 'e', 'PT400'),
      jsonb_build_object('l', 'account name a number', 'rows', '[{"account_code": "1", "account_name": 5, "month": "2025-01-01", "amount": "1.00"}]'::jsonb, 'e', 'PT400'),
      jsonb_build_object('l', 'account name of 201 characters', 'rows', jsonb_build_array(fpa_test.r('1', '2025-01-01', '1.00', repeat('n', 201))), 'e', 'PT400'),
      jsonb_build_object('l', 'month mid-month', 'rows', jsonb_build_array(fpa_test.r('1', '2025-02-15', '1.00')), 'e', 'PT400'),
      jsonb_build_object('l', 'month 13', 'rows', jsonb_build_array(fpa_test.r('1', '2025-13-01', '1.00')), 'e', 'PT400'),
      jsonb_build_object('l', 'month without a day', 'rows', jsonb_build_array(fpa_test.r('1', '2025-02', '1.00')), 'e', 'PT400'),
      jsonb_build_object('l', 'month after this month', 'rows', jsonb_build_array(fpa_test.r('1', to_char(date_trunc('month', now()) + interval '1 month', 'YYYY-MM-DD'), '1.00')), 'e', 'PT400'),
      jsonb_build_object('l', 'month before 2000', 'rows', jsonb_build_array(fpa_test.r('1', '1999-12-01', '1.00')), 'e', 'PT400'),
      jsonb_build_object('l', 'amount text', 'rows', jsonb_build_array(fpa_test.r('1', '2025-01-01', 'abc')), 'e', 'PT400'),
      jsonb_build_object('l', 'amount with three decimals', 'rows', jsonb_build_array(fpa_test.r('1', '2025-01-01', '1.234')), 'e', 'PT400'),
      jsonb_build_object('l', 'amount NaN', 'rows', jsonb_build_array(fpa_test.r('1', '2025-01-01', 'NaN')), 'e', 'PT400'),
      jsonb_build_object('l', 'amount Infinity', 'rows', jsonb_build_array(fpa_test.r('1', '2025-01-01', 'Infinity')), 'e', 'PT400'),
      jsonb_build_object('l', 'amount 1e20 (too many digits)', 'rows', '[{"account_code": "1", "month": "2025-01-01", "amount": 1e20}]'::jsonb, 'e', 'PT400'),
      jsonb_build_object('l', 'amount true', 'rows', '[{"account_code": "1", "month": "2025-01-01", "amount": true}]'::jsonb, 'e', 'PT400'),
      jsonb_build_object('l', 'amount null', 'rows', '[{"account_code": "1", "month": "2025-01-01", "amount": null}]'::jsonb, 'e', 'PT400'),
      jsonb_build_object('l', 'duplicate account and month', 'rows', jsonb_build_array(fpa_test.r('1', '2025-01-01', '1.00'), fpa_test.r(' 1', '2025-01-01', '2.00')), 'e', 'PT400'),
      jsonb_build_object('l', '20,001 rows', 'rows', (SELECT jsonb_agg(fpa_test.r('A' || g, '2025-01-01', '1.00')) FROM generate_series(1, 20001) g), 'e', 'PT413'),
      jsonb_build_object('l', 'more than 5 MB', 'rows', (SELECT jsonb_agg(fpa_test.r('A' || g, '2025-01-01', '1.00', repeat('n', 200))) FROM generate_series(1, 20000) g), 'e', 'PT413')
    )) x LOOP
    v_got := fpa_test.attempt(format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca, v_case -> 'rows', 'bad.csv'));
    PERFORM fpa_test.check(v_got = v_case ->> 'e', 'refused: ' || (v_case ->> 'l'), v_got);
  END LOOP;
  v_rows := jsonb_build_array(fpa_test.r('1', '2025-01-01', '1.00'));
  FOREACH v_sql IN ARRAY ARRAY[
      format('SELECT fpa.import_actuals(%L, %L, NULL, %L)', v_ea, v_ca, 'bad.csv') || '|PT400|rows NULL',
      format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca, v_rows, '  ') || '|PT400|blank file name',
      format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca, v_rows, repeat('f', 201)) || '|PT400|file name of 201 characters',
      format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca2, v_rows, 'x.csv') || '|PT400|a connection that is not CSV',
      format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca3, v_rows, 'x.csv') || '|PT409|a disabled connection',
      format('SELECT fpa.import_actuals(NULL, %L, %L::jsonb, %L)', v_ca, v_rows, 'x.csv') || '|PT403|no entity',
      format('SELECT fpa.import_actuals(%L, NULL, %L::jsonb, %L)', v_ea, v_rows, 'x.csv') || '|PT404|no connection'] LOOP
    v_got := fpa_test.attempt(split_part(v_sql, '|', 1));
    PERFORM fpa_test.check(v_got = split_part(v_sql, '|', 2), 'refused: ' || split_part(v_sql, '|', 3), v_got);
  END LOOP;
  v_got := fpa_test.attempt(format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca,
    (SELECT jsonb_agg(fpa_test.r('A' || g, '2025-01-01', '1.00')) FROM generate_series(1, 20000) g), 'limit.csv'));
  PERFORM fpa_test.check(v_got = 'ok:1', 'exactly 20,000 rows are accepted', v_got);
  v_got := fpa_test.try_msg(format('SELECT fpa.import_actuals(%L, %L, %L::jsonb, %L)', v_ea, v_ca,
    jsonb_build_array(fpa_test.r('1', '2025-01-01', '1.00'), fpa_test.r('2', '2025-01-01', '1.5x')), 'x.csv'));
  PERFORM fpa_test.check(v_got LIKE 'PT400: Row 2: the amount%', 'the error names the row and the problem', v_got);
  PERFORM fpa_test.check((SELECT count(*) = v_n AND sum(a.amount) = v_sum FROM fpa.actuals_monthly a WHERE a.connection_id = v_ca)
    AND (SELECT count(*) FROM fpa.sync_runs) = 2, 'after every refusal, actuals and the sync log are unchanged');

  -- ── 6. Direct writes stay refused; sync_runs read by members only ──
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.attempt(format('INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, period, amount) VALUES (%L, %L, ''1'', ''2025-01-01'', 1)', v_ea, v_ca));
    PERFORM fpa_test.check(v_got = e_none[i], 'actuals_monthly direct insert refused as ' || v_who[i], v_got);
    v_got := fpa_test.attempt(format('UPDATE fpa.actuals_monthly SET amount = 0 WHERE connection_id = %L', v_ca));
    PERFORM fpa_test.check(v_got = e_none[i], 'actuals_monthly direct update refused as ' || v_who[i], v_got);
    v_got := fpa_test.attempt(format('INSERT INTO fpa.sync_runs (entity_id, connection_id, run_by, source_name, months_replaced, rows_removed, rows_added, status) VALUES (%L, %L, ''user_x'', ''x'', ''{2025-01-01}'', 0, 0, ''succeeded'')', v_ea, v_ca));
    PERFORM fpa_test.check(v_got = e_none[i], 'sync_runs direct insert refused as ' || v_who[i], v_got);
    v_got := fpa_test.attempt('UPDATE fpa.sync_runs SET status = ''failed''');
    PERFORM fpa_test.check(v_got = e_none[i], 'sync_runs direct update refused as ' || v_who[i], v_got);
    v_got := fpa_test.val('SELECT count(*)::text FROM fpa.sync_runs');
    v_exp := (ARRAY['2', '2', '2', '0', '0', '1', '42501', '42501'])[i];
    PERFORM fpa_test.check(v_got = v_exp, 'sync_runs rows seen as ' || v_who[i], v_got);
  END LOOP;
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(NOT has_table_privilege('authenticated', 'fpa.sync_runs', 'DELETE') AND NOT has_table_privilege('authenticated', 'fpa.plan_line_defs', 'DELETE')
    AND NOT has_table_privilege('authenticated', 'fpa.actuals_monthly', 'DELETE'), 'no API role may delete sync runs, plan-line definitions or actuals');

  -- ── 7. Line map ──
  v_rows := '[{"account_code": "4000", "plan_line": "revenue"}]'::jsonb;
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.attempt(format('SELECT fpa.set_line_map(%L, %L::jsonb)', v_ca, v_rows));
    PERFORM fpa_test.check(v_got = e_edit[i], 'set_line_map on A''s connection as ' || v_who[i], v_got);
  END LOOP;
  PERFORM fpa_test.as_user('user_ownerB');
  v_got := fpa_test.attempt(format('SELECT fpa.set_line_map(%L, %L::jsonb)', v_ca, v_rows));
  PERFORM fpa_test.check(v_got = 'PT403', 'cross-entity: owner B cannot map A''s accounts', v_got);
  PERFORM fpa_test.as_user('user_editorA');
  FOR v_case IN SELECT x FROM jsonb_array_elements('[
      {"l": "a calculated line", "m": [{"account_code": "4000", "plan_line": "gross_profit"}]},
      {"l": "the Unmapped line", "m": [{"account_code": "4000", "plan_line": "unmapped"}]},
      {"l": "a made-up line", "m": [{"account_code": "4000", "plan_line": "sales"}]},
      {"l": "a plan line that is not text", "m": [{"account_code": "4000", "plan_line": 5}]},
      {"l": "an unknown field", "m": [{"account_code": "4000", "plan_line": "revenue", "sign": -1}]},
      {"l": "an account listed twice", "m": [{"account_code": "4000", "plan_line": "revenue"}, {"account_code": "4000", "plan_line": "payroll"}]},
      {"l": "an empty list", "m": []},
      {"l": "not a list", "m": {"account_code": "4000"}}]'::jsonb) x LOOP
    v_got := fpa_test.attempt(format('SELECT fpa.set_line_map(%L, %L::jsonb)', v_ca, v_case -> 'm'));
    PERFORM fpa_test.check(v_got = 'PT400', 'set_line_map refuses ' || (v_case ->> 'l'), v_got);
  END LOOP;
  v_got := fpa_test.attempt(format('INSERT INTO fpa.line_map (connection_id, account_code, plan_line) VALUES (%L, ''9999'', ''net_profit'')', v_ca));
  PERFORM fpa_test.check(v_got = '23503', 'a direct line_map insert naming a calculated line is refused by the foreign key', v_got);
  v_got := fpa_test.attempt(format('INSERT INTO fpa.line_map (connection_id, account_code, plan_line) VALUES (%L, ''9999'', ''revenue.sales'')', v_ca));
  PERFORM fpa_test.check(v_got = '23503', 'a direct line_map insert naming a line not in the list is refused', v_got);
  v_got := fpa_test.attempt(format('INSERT INTO fpa.line_map (connection_id, account_code, plan_line) VALUES (%L, ''9999'', ''payroll'')', v_ca));
  PERFORM fpa_test.check(v_got = 'ok:1', 'a direct line_map insert naming a mappable line still works for an editor (Phase 0 path)', v_got);
  v_n := fpa.set_line_map(v_ca, '[{"account_code": "4000", "plan_line": "revenue"}, {"account_code": "5000", "plan_line": "cost_of_sales"},
    {"account_code": "6000", "plan_line": "payroll"}, {"account_code": "7000", "plan_line": "premises"}, {"account_code": "1200", "plan_line": "excluded"},
    {"account_code": "8000", "plan_line": "marketing"}]'::jsonb);
  v_n2 := fpa.set_line_map(v_ca, '[{"account_code": "8000", "plan_line": null}, {"account_code": "4000", "plan_line": "revenue"}, {"account_code": "7000"}]'::jsonb);
  PERFORM fpa_test.check(v_n = 6 AND v_n2 = 2, 'set_line_map counts: 6 added; then 8000 and 7000 removed (null or no line), 4000 unchanged', v_n || ', ' || v_n2);
  PERFORM fpa.set_line_map(v_ca, '[{"account_code": "7000", "plan_line": "premises"}]'::jsonb);
  PERFORM fpa_test.check((SELECT string_agg(m.account_code || '=' || m.plan_line, ',' ORDER BY m.account_code) FROM fpa.line_map m WHERE m.connection_id = v_ca)
    = '1200=excluded,4000=revenue,5000=cost_of_sales,6000=payroll,7000=premises', 'the line map holds exactly what was set (8000 unmapped)');

  -- account_map and unmapped_accounts, as every role
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.val(format('SELECT string_agg(format(''%%s:%%s:%%s:%%s:%%s:%%s'', m.account_code, coalesce(m.account_name, ''-''), coalesce(m.plan_line, ''-''), m.months, m.last_month, m.total), '','') FROM fpa.account_map(%L) m', v_ea));
    v_exp := CASE WHEN i <= 3 THEN '8000:Sundry:-:2:2025-03-01:300.00,1200:Bank:excluded:3:2025-03-01:9400.00,4000:Sales:revenue:4:2025-04-01:-42500.00,'
                                   '5000:Purchases:cost_of_sales:4:2025-04-01:16600.00,6000:Wages:payroll:3:2025-03-01:9100.50,7000:Rent:premises:2:2025-03-01:2000.00'
                  WHEN i <= 6 THEN 'null' ELSE '42501' END;
    PERFORM fpa_test.check(v_got = v_exp, 'account_map of entity A as ' || v_who[i] || ' (unmapped first; names from the latest month)', v_got);
    v_got := fpa_test.val(format('SELECT string_agg(u.account_code || '':'' || u.total, '','') FROM fpa.unmapped_accounts(%L) u', v_ea));
    v_exp := CASE WHEN i <= 3 THEN '8000:300.00' WHEN i <= 6 THEN 'null' ELSE '42501' END;
    PERFORM fpa_test.check(v_got = v_exp, 'unmapped_accounts of entity A as ' || v_who[i], v_got);
  END LOOP;
  PERFORM fpa_test.as_user('user_editorA');
  PERFORM fpa_test.check(fpa_test.val(format('SELECT count(*)::text FROM fpa.account_map(%L)', v_eb)) = '0', 'cross-entity: editor A sees none of B''s accounts');

  -- ── 8. Variance against hand-computed figures ──
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_pa, 'budget', 'Budget 2025') RETURNING id INTO v_va;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_va, 'Base', true) RETURNING id INTO v_sa;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_va, 'Upside', false) RETURNING id INTO v_sa2;
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES
    (v_va, v_sa, 'revenue', '2025-01-01', -11000.00, 'manual'), (v_va, v_sa, 'revenue', '2025-02-01', 0.00, 'manual'), (v_va, v_sa, 'revenue', '2025-03-01', -10000.00, 'manual'),
    (v_va, v_sa, 'cost_of_sales', '2025-01-01', 4400.00, 'manual'), (v_va, v_sa, 'cost_of_sales', '2025-02-01', 4400.00, 'manual'), (v_va, v_sa, 'cost_of_sales', '2025-03-01', 4400.00, 'manual'),
    (v_va, v_sa, 'payroll', '2025-01-01', 3000.00, 'manual'), (v_va, v_sa, 'payroll', '2025-02-01', 3000.00, 'manual'), (v_va, v_sa, 'payroll', '2025-03-01', 3000.00, 'manual'),
    (v_va, v_sa, 'premises', '2025-01-01', 1000.00, 'manual'), (v_va, v_sa, 'premises', '2025-02-01', 1000.00, 'manual'), (v_va, v_sa, 'premises', '2025-03-01', 1000.00, 'manual'),
    (v_va, v_sa, 'marketing', '2025-01-01', 200.00, 'manual'),
    (v_va, v_sa2, 'revenue', '2025-01-01', -99999.00, 'manual');
  v_got := fpa_test.attempt(format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''gross_profit'', ''2025-01-01'', 1, ''manual'')', v_va, v_sa));
  PERFORM fpa_test.check(v_got = '23503', 'a budget line on a calculated line is refused by the foreign key', v_got);
  v_got := fpa_test.attempt(format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''excluded'', ''2025-01-01'', 1, ''manual'')', v_va, v_sa));
  PERFORM fpa_test.check(v_got = '23503', 'a budget line on Excluded is refused by the foreign key', v_got);

  PERFORM fpa_test.as_user('user_viewerA');
  FOR v_case IN SELECT x FROM jsonb_array_elements('[
      ["revenue", "2025-01-01", "10000.00|11000.00|-1000.00|-9.0909|false"],
      ["cost_of_sales", "2025-01-01", "4000.00|4400.00|-400.00|-9.0909|true"],
      ["gross_profit", "2025-01-01", "6000.00|6600.00|-600.00|-9.0909|false"],
      ["payroll", "2025-01-01", "3000.00|3000.00|0.00|0.0000|true"],
      ["marketing", "2025-01-01", "0|200.00|-200.00|-100.0000|true"],
      ["premises", "2025-01-01", "1000.00|1000.00|0.00|0.0000|true"],
      ["other_operating", "2025-01-01", "0|0|0|null|true"],
      ["operating_profit", "2025-01-01", "2000.00|2400.00|-400.00|-16.6667|false"],
      ["interest", "2025-01-01", "0|0|0|null|true"],
      ["net_profit", "2025-01-01", "2000.00|2400.00|-400.00|-16.6667|false"],
      ["unmapped", "2025-01-01", "250.00|0|250.00|null|null"],
      ["revenue", "2025-02-01", "12500.00|0.00|12500.00|null|true"],
      ["payroll", "2025-02-01", "3000.50|3000.00|0.50|0.0167|false"],
      ["net_profit", "2025-02-01", "4999.50|-8400.00|13399.50|159.5179|true"],
      ["unmapped", "2025-02-01", "0|0|0|null|null"],
      ["net_profit", "2025-03-01", "2700.00|1600.00|1100.00|68.7500|true"],
      ["unmapped", "2025-03-01", "50.00|0|50.00|null|null"],
      ["revenue", "2025-04-01", "9000.00|null|null|null|null"],
      ["net_profit", "2025-04-01", "5100.00|null|null|null|null"],
      ["revenue", "2025-05-01", "null|null|null|null|null"]]'::jsonb) x LOOP
    v_got := fpa_test.cell(v_ea, v_va, v_case ->> 0, (v_case ->> 1)::date);
    PERFORM fpa_test.check(v_got = v_case ->> 2, format('variance %s %s = %s', v_case ->> 0, left(v_case ->> 1, 7), v_case ->> 2), v_got);
  END LOOP;
  PERFORM fpa_test.check((SELECT count(*) FROM fpa.variance(v_ea, v_va, '2025-01-01', '2025-05-01')) = 60
    AND NOT EXISTS (SELECT 1 FROM fpa.variance(v_ea, v_va, '2025-01-01', '2025-05-01') v WHERE v.line_key = 'excluded'),
    'variance: 12 lines x 5 months; Excluded (the bank account) is not a P&L line');
  PERFORM fpa_test.check((SELECT string_agg(coalesce(v.actual::text, 'null'), ',' ORDER BY v.month) FROM fpa.variance(v_ea, NULL, '2025-01-01', '2025-05-01') v WHERE v.line_key = 'revenue')
    = '10000.00,12500.00,11000.00,9000.00,null' AND NOT EXISTS (SELECT 1 FROM fpa.variance(v_ea, NULL, '2025-01-01', '2025-05-01') v WHERE v.budget IS NOT NULL),
    'variance with no version: actuals only, every budget null');
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.val(format('SELECT count(*)::text FROM fpa.variance(%L, %L, ''2025-01-01'', ''2025-05-01'')', v_ea, v_va));
    v_exp := (ARRAY['60', '60', '60', 'PT404', 'PT404', 'PT404', '42501', '42501'])[i];
    PERFORM fpa_test.check(v_got = v_exp, 'variance of entity A as ' || v_who[i], v_got);
  END LOOP;
  PERFORM fpa_test.as_user('user_ownerB');
  v_got := fpa_test.val(format('SELECT count(*)::text FROM fpa.variance(%L, %L, ''2025-01-01'', ''2025-05-01'')', v_eb, v_va));
  PERFORM fpa_test.check(v_got = 'PT404', 'cross-entity: owner B cannot read A''s budget through B''s entity', v_got);
  v_got := fpa_test.val(format('SELECT string_agg(coalesce(v.actual::text, ''null''), '','' ORDER BY v.month) FROM fpa.variance(%L, %L, ''2025-01-01'', ''2025-02-01'') v WHERE v.line_key = ''unmapped''', v_eb, v_vb));
  PERFORM fpa_test.check(v_got = '-500.00,null', 'owner B''s own variance shows only B''s actuals', v_got);
  PERFORM fpa_test.as_user('user_viewerA');
  FOREACH v_sql IN ARRAY ARRAY[
      format('SELECT count(*)::text FROM fpa.variance(%L, NULL, ''2025-01-15'', ''2025-05-01'')', v_ea) || '|PT400|variance from mid-month',
      format('SELECT count(*)::text FROM fpa.variance(%L, NULL, ''2025-05-01'', ''2025-01-01'')', v_ea) || '|PT400|variance with to before from',
      format('SELECT count(*)::text FROM fpa.variance(%L, NULL, ''2025-01-01'', ''2028-01-01'')', v_ea) || '|PT400|variance over 37 months',
      format('SELECT count(*)::text FROM fpa.variance(%L, NULL, NULL, ''2025-01-01'')', v_ea) || '|PT400|variance with no start',
      format('SELECT count(*)::text FROM fpa.variance(%L, NULL, ''2025-01-01'', ''2027-12-01'')', v_ea) || '|432|variance over exactly 36 months (12 lines x 36)'] LOOP
    v_got := fpa_test.val(split_part(v_sql, '|', 1));
    PERFORM fpa_test.check(v_got = split_part(v_sql, '|', 2), split_part(v_sql, '|', 3), v_got);
  END LOOP;

  -- ── 9. Budget from actuals: the shared rounding cases, permissions, refusals, locks ──
  -- 12 months of 2024 for eight accounts, one per budget line, amounts from the shared fixture.
  PERFORM fpa_test.as_user('user_editorA');
  SELECT jsonb_agg(fpa_test.r('B' || c.n, to_char(DATE '2024-01-01' + make_interval(months => (m.k - 1)::int), 'YYYY-MM-DD'), m.amt) ORDER BY c.n, m.k) INTO v_rows
    FROM jsonb_array_elements(v_cases -> 'cases') WITH ORDINALITY AS c(cs, n), jsonb_array_elements_text(c.cs -> 'actuals') WITH ORDINALITY AS m(amt, k);
  PERFORM fpa.import_actuals(v_ea, v_ca, v_rows, 'rounding-cases.csv');
  v_got := fpa_test.try_msg(format('SELECT fpa.create_budget_from_actuals(%L, NULL, ''Too early'', ''2024-01-01'', ''2026-01-01'', ''{}'')', v_pa));
  PERFORM fpa_test.check(v_got LIKE 'PT409: Map every account first. Unmapped: B1, B2, B3, B4, B5, B6, B7, B8', 'refused while accounts in the window are unmapped, naming them', v_got);
  SELECT jsonb_agg(jsonb_build_object('account_code', 'B' || c.n, 'plan_line', c.cs ->> 'plan_line')) INTO v_rows FROM jsonb_array_elements(v_cases -> 'cases') WITH ORDINALITY AS c(cs, n);
  PERFORM fpa.set_line_map(v_ca, v_rows);
  v_got := fpa_test.try_msg(format('SELECT fpa.create_budget_from_actuals(%L, NULL, ''Gap'', ''2023-12-01'', ''2026-01-01'', ''{}'')', v_pa));
  PERFORM fpa_test.check(v_got LIKE 'PT409: Every month from 2023-12 to 2024-11 needs actuals%', 'refused when a month in the window has no actuals', v_got);
  v_got := fpa_test.try_msg(format('SELECT fpa.create_budget_from_actuals(%L, NULL, ''Overlap'', ''2024-02-01'', ''2026-01-01'', ''{}'')', v_pa));
  PERFORM fpa_test.check(v_got LIKE 'PT409: Map every account first. Unmapped: 8000', 'refused when the window reaches an unmapped account (8000 in 2025-01)', v_got);
  SELECT jsonb_object_agg(c.cs ->> 'plan_line', c.cs ->> 'uplift') INTO v_rows FROM jsonb_array_elements(v_cases -> 'cases') AS c(cs);
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.attempt(format('SELECT fpa.create_budget_from_actuals(%L, NULL, ''Perm'', ''2024-01-01'', ''2026-01-01'', %L::jsonb)', v_pa, v_rows));
    PERFORM fpa_test.check(v_got = e_edit[i], 'create_budget_from_actuals on plan A as ' || v_who[i], v_got);
  END LOOP;
  PERFORM fpa_test.as_user('user_ownerB');
  v_got := fpa_test.attempt(format('SELECT fpa.create_budget_from_actuals(%L, %L, NULL, ''2024-01-01'', ''2026-01-01'', ''{}'')', v_pb, v_va));
  PERFORM fpa_test.check(v_got = 'PT404', 'cross-entity: owner B cannot write into A''s version through B''s plan', v_got);
  PERFORM fpa_test.as_user('user_editorA');
  v_vn := fpa.create_budget_from_actuals(v_pa, NULL, 'Budget 2026', '2024-01-01', '2026-01-01', v_rows);
  FOR v_case IN SELECT x FROM jsonb_array_elements(v_cases -> 'cases') x LOOP
    SELECT string_agg(l.amount::text, ',' ORDER BY l.period), sum(l.amount)::text INTO v_got, v_t
      FROM fpa.plan_lines l WHERE l.version_id = v_vn AND l.plan_line = v_case ->> 'plan_line';
    SELECT string_agg(e, ',' ORDER BY k) INTO v_exp FROM jsonb_array_elements_text(v_case -> 'expected') WITH ORDINALITY AS t(e, k);
    PERFORM fpa_test.check(v_got = v_exp AND v_t = v_case ->> 'annual', format('rounding case %s (%s): months match the shared fixture and sum to %s', v_case ->> 'plan_line', v_case ->> 'note', v_case ->> 'annual'), v_got || ' / ' || v_t);
  END LOOP;
  PERFORM fpa_test.check((SELECT count(*) = 96 AND bool_and(l.origin = 'from_actuals') AND min(l.period) = '2026-01-01' AND max(l.period) = '2026-12-01'
      AND bool_and(s.is_base) FROM fpa.plan_lines l JOIN fpa.scenarios s ON s.id = l.scenario_id WHERE l.version_id = v_vn)
    AND (SELECT v.kind = 'budget' AND v.name = 'Budget 2026' FROM fpa.plan_versions v WHERE v.id = v_vn),
    'a new budget version with a base scenario and 8 lines x 12 months (2026), origin from_actuals');
  FOREACH v_sql IN ARRAY ARRAY[
      '{"gross_profit": 5}|a calculated line', '{"excluded": 5}|Excluded', '{"revenue": "abc"}|a word', '{"revenue": -100.01}|below -100%',
      '{"revenue": 1000.01}|above 1000%', '{"revenue": 1.234}|three decimals', '{"revenue": null}|null', '[]|a list instead of an object'] LOOP
    v_got := fpa_test.attempt(format('SELECT fpa.create_budget_from_actuals(%L, NULL, ''Bad'', ''2024-01-01'', ''2026-01-01'', %L::jsonb)', v_pa, split_part(v_sql, '|', 1)));
    PERFORM fpa_test.check(v_got = 'PT400', 'uplift refused: ' || split_part(v_sql, '|', 2), v_got);
  END LOOP;
  FOREACH v_sql IN ARRAY ARRAY[
      format('SELECT fpa.create_budget_from_actuals(%L, NULL, ''X'', ''2024-01-15'', ''2026-01-01'', ''{}'')', v_pa) || '|PT400|window not on the first of a month',
      format('SELECT fpa.create_budget_from_actuals(%L, NULL, ''X'', ''2024-01-01'', ''2026-01-02'', ''{}'')', v_pa) || '|PT400|budget not on the first of a month',
      format('SELECT fpa.create_budget_from_actuals(%L, NULL, ''  '', ''2024-01-01'', ''2026-01-01'', ''{}'')', v_pa) || '|PT400|blank name for a new version',
      format('SELECT fpa.create_budget_from_actuals(%L, %L, NULL, ''2024-01-01'', ''2026-01-01'', ''{}'')', v_pa, v_vb) || '|PT404|a version from another plan',
      format('SELECT fpa.create_budget_from_actuals(NULL, NULL, ''X'', ''2024-01-01'', ''2026-01-01'', ''{}'')', v_pa) || '|PT403|no plan'] LOOP
    v_got := fpa_test.attempt(split_part(v_sql, '|', 1));
    PERFORM fpa_test.check(v_got = split_part(v_sql, '|', 2), 'budget refused: ' || split_part(v_sql, '|', 3), v_got);
  END LOOP;
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_pa, 'forecast', 'A forecast') RETURNING id INTO v_vf;
  v_got := fpa_test.attempt(format('SELECT fpa.create_budget_from_actuals(%L, %L, NULL, ''2024-01-01'', ''2026-01-01'', ''{}'')', v_pa, v_vf));
  PERFORM fpa_test.check(v_got = 'PT400', 'budget refused: a forecast version', v_got);

  -- Locks: editors lock; the function refuses a locked version; only an owner unlocks (Phase 0 rule).
  UPDATE fpa.plan_versions SET locked_at = now() WHERE id = v_vn;
  v_got := fpa_test.try_msg(format('SELECT fpa.create_budget_from_actuals(%L, %L, NULL, ''2024-01-01'', ''2026-01-01'', ''{}'')', v_pa, v_vn));
  PERFORM fpa_test.check(v_got LIKE 'PT423: This version is locked%', 'budget from actuals refuses a locked version', v_got);
  v_got := fpa_test.attempt(format('UPDATE fpa.plan_lines SET amount = 1, origin = ''manual'' WHERE version_id = %L', v_vn));
  PERFORM fpa_test.check(v_got = 'PT423', 'a locked version''s lines cannot be edited', v_got);
  PERFORM fpa_test.as_user('user_viewerA');
  v_got := fpa_test.attempt(format('UPDATE fpa.plan_versions SET locked_at = NULL WHERE id = %L', v_vn));
  PERFORM fpa_test.check(v_got = 'ok:0', 'a viewer cannot unlock (row security: no row)', v_got);
  PERFORM fpa_test.as_user('user_editorA');
  v_got := fpa_test.attempt(format('UPDATE fpa.plan_versions SET locked_at = NULL WHERE id = %L', v_vn));
  PERFORM fpa_test.check(v_got = 'PT403', 'an editor cannot unlock (owner only, Phase 0 rule still holds)', v_got);
  PERFORM fpa_test.as_user('user_ownerA');
  UPDATE fpa.plan_versions SET locked_at = NULL WHERE id = v_vn;
  PERFORM fpa_test.as_user('user_editorA');
  PERFORM fpa.create_budget_from_actuals(v_pa, v_vn, NULL, '2024-01-01', '2026-01-01', '{"revenue": 100}'::jsonb);
  PERFORM fpa_test.check((SELECT count(*) = 96 AND sum(l.amount) FILTER (WHERE l.plan_line = 'revenue') = 0.24 FROM fpa.plan_lines l WHERE l.version_id = v_vn)
    AND (SELECT v.unlocked_by = 'user_ownerA' FROM fpa.plan_versions v WHERE v.id = v_vn),
    'after an owner unlocks, rebuilding replaces the 12 months (still 96 lines; revenue at +100% now 0.24)');

  -- ── 10. Functions and structure ──
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE'))
    AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('service_role', p.oid, 'EXECUTE'))
    AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.pronamespace = 'fpa'::regnamespace AND a.grantee = 0),
    'no fpa function is executable by anon, service_role or PUBLIC');
  SELECT string_agg(p.proname || ':' || CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END, ',' ORDER BY p.proname) INTO v_got
    FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
     AND p.proname IN ('import_actuals', 'set_line_map', 'account_map', 'unmapped_accounts', 'variance', 'create_budget_from_actuals')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND p.proconfig::text LIKE '%search_path=fpa, pg_temp%';
  PERFORM fpa_test.check(v_got = 'account_map:invoker,create_budget_from_actuals:invoker,import_actuals:definer,set_line_map:invoker,unmapped_accounts:invoker,variance:invoker',
    'the six new functions: executable by authenticated, fixed search_path, only import_actuals is SECURITY DEFINER', v_got);
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
      AND p.proname IN ('plan_entity', 'version_entity', 'scenario_entity', 'driver_entity', 'connection_entity', 'touch_updated_at',
                        'guard_locked_version', 'guard_locked_child', 'guard_locked_driver_value', 'check_driver_value_plan')
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), 'internal helpers are still executable by no API role');
  PERFORM fpa_test.check((SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity) = 16
    AND (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r') = 16, 'all 16 tables have row security enabled');
  PERFORM fpa_test.check((SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                           WHERE c.relnamespace = 'fpa'::regnamespace AND t.tgname = c.relname || '_updated_at') = 16, 'every table has its updated_at trigger');
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.connamespace = 'fpa'::regnamespace AND k.contype = 'f'
                                      AND k.confrelid::regclass::text NOT LIKE 'fpa.%'), 'no foreign key from fpa into any other schema');
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                                      WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
                                        AND a.atttypid IN ('real'::regtype, 'double precision'::regtype, 'money'::regtype)), 'no float or money columns');
  PERFORM fpa_test.check(has_schema_privilege('authenticated', 'fpa', 'USAGE') AND NOT has_schema_privilege('anon', 'fpa', 'USAGE')
    AND NOT has_schema_privilege('service_role', 'fpa', 'USAGE'), 'schema usage: authenticated only (unchanged)');
END $test$;

-- Report: failures, pass count, and the privilege evidence for the tables and functions 0003 adds or
-- changes (kept short: the connector cuts error messages longer than about 10,000 characters).
DO $report$
DECLARE v_fail text; v_pass int; v_fails int; v_out text;
BEGIN
  SELECT count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass),
         string_agg(CASE WHEN NOT pass THEN label || coalesce(' [got ' || detail || ']', '') END, ' | ' ORDER BY n)
    INTO v_pass, v_fails, v_fail FROM fpa_test.results;
  v_out := format(E'%s failure(s), %s pass(es)%s\n', v_fails, v_pass, CASE WHEN v_fails > 0 THEN E'\nFAILED: ' || v_fail ELSE '' END);
  v_out := v_out || E'\n== Tables 0003 adds or changes: row security and ACL, less the owner entry ==\n'
    || (SELECT string_agg(format('%s: rls=%s %s', c.relname, c.relrowsecurity,
          coalesce(nullif(array_to_string(ARRAY(SELECT x::text FROM unnest(c.relacl) x WHERE x::text <> 'postgres=arwdDxtm/postgres'), ','), ''), '(owner only)')), E'\n' ORDER BY c.relname)
        FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND c.relname IN ('plan_line_defs', 'sync_runs', 'actuals_monthly', 'line_map', 'plan_lines'));
  v_out := v_out || E'\n\n== Column grants on those tables ==\n' || coalesce((SELECT string_agg(format('%s: %s', c.relname, x.cols), E'\n' ORDER BY c.relname)
    FROM pg_class c, LATERAL (SELECT string_agg(format('%s %s(%s)', p.who, p.priv, p.cols), ' ') AS cols FROM (
        SELECT a.privilege_type AS priv, pg_get_userbyid(a.grantee) AS who, string_agg(at.attname, ',' ORDER BY at.attnum) AS cols
          FROM pg_attribute at, aclexplode(at.attacl) a WHERE at.attrelid = c.oid AND at.attacl IS NOT NULL AND NOT at.attisdropped
         GROUP BY a.privilege_type, a.grantee ORDER BY 1) p) x
    WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND x.cols IS NOT NULL AND c.relname IN ('plan_line_defs', 'sync_runs', 'actuals_monthly', 'line_map', 'plan_lines')), '(none)');
  v_out := v_out || E'\n\n== Policies on the new tables ==\n'
    || (SELECT string_agg(format('%s %s to %s using %s', p.policyname, p.cmd, array_to_string(p.roles, ','), replace(p.qual, 'fpa.', '')), E'\n' ORDER BY p.policyname)
        FROM pg_policies p WHERE p.schemaname = 'fpa' AND p.tablename IN ('plan_line_defs', 'sync_runs'))
    || E'\nAll policies in fpa: ' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'fpa')::text || ', all TO authenticated only: '
    || (SELECT bool_and(p.roles = '{authenticated}'::name[]) FROM pg_policies p WHERE p.schemaname = 'fpa')::text;
  v_out := v_out || E'\n\n== New functions: ACL, security, volatility, EXECUTE by role ==\n' || (SELECT string_agg(format('%s: definer=%s %s acl=%s | anon=%s authenticated=%s service_role=%s PUBLIC=%s',
        p.oid::regprocedure, p.prosecdef, CASE p.provolatile WHEN 's' THEN 'stable' WHEN 'i' THEN 'immutable' ELSE 'volatile' END, coalesce(array_to_string(p.proacl, ','), '(default)'),
        has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('service_role', p.oid, 'EXECUTE'),
        EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')), E'\n' ORDER BY p.proname)
    FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND p.proname IN ('import_actuals', 'set_line_map', 'account_map', 'unmapped_accounts', 'variance', 'create_budget_from_actuals'));
  v_out := v_out || E'\n\n== Verdict, all ' || (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace)::text || E' fpa functions ==\nExecutable by PUBLIC: '
    || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
        AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')), 'none')
    || E'\nExecutable by anon: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')), 'none')
    || E'\nExecutable by service_role: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('service_role', p.oid, 'EXECUTE')), 'none')
    || E'\nExecutable by authenticated: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), 'none')
    || E'\nExecutable by no API role (internal): ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')), 'none');
  RAISE EXCEPTION '%', v_out;
END $report$;
