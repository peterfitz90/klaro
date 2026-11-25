-- Tests for 0004_fpa_balances_cash.sql. Run AFTER the migration INSIDE ONE TRANSACTION
-- (db/bundle.mjs builds db/out/test_0004.sql: BEGIN; 0004; this file). 0001 and 0003 are already
-- applied on the database. The report block at the end always raises, so everything, including the
-- fpa_test helpers and every fixture row, rolls back.
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
CREATE FUNCTION fpa_test.fail_balance_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.account_code = current_setting('fpa_test.fail_account', true) THEN RAISE EXCEPTION 'injected failure at account %', NEW.account_code; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_test_fail BEFORE INSERT ON fpa.sync_runs FOR EACH ROW EXECUTE FUNCTION fpa_test.fail_sync_run();
CREATE TRIGGER zz_test_fail BEFORE INSERT ON fpa.balances_monthly FOR EACH ROW EXECUTE FUNCTION fpa_test.fail_balance_row();
-- One import row.
CREATE FUNCTION fpa_test.r(p_code text, p_month text, p_amount text, p_name text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('account_code', p_code, 'month', p_month, 'amount', p_amount, 'account_name', p_name)); $$;
-- cash_position as one line of text, newest month first: 'latest|available|unmapped' then 'month:has:cash' x5.
CREATE FUNCTION fpa_test.cash(p_entity uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(min(c.latest_month)::text || '|' || min(c.months_available) || '|' || min(c.unmapped_accounts) || ' '
         || string_agg(format('%s:%s:%s', to_char(c.month, 'YYYY-MM'), c.has_balances::text, coalesce(c.cash::text, 'null')), ' ' ORDER BY c.month DESC), 'none')
    FROM fpa.cash_position(p_entity) c; $$;
-- The 0003 variance, exactly as applied (db/bundle.mjs inserts its text, renamed into fpa_test), to show
-- that 0004 changes nothing but leaving out balance lines.
__VARIANCE_0003_AS_TEST__
GRANT USAGE ON SCHEMA fpa_test TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA fpa_test TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA fpa_test TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fpa_test TO anon, authenticated, service_role;

DO $test$
DECLARE
  v_who constant text[] := ARRAY['user_ownerA', 'user_editorA', 'user_viewerA', 'user_inactiveA', 'user_outsider', 'user_ownerB', 'anon', 'service_role'];
  e_edit constant text[] := ARRAY['ok:1', 'ok:1', 'PT403', 'PT403', 'PT403', 'PT403', '42501', '42501'];
  v_ea uuid; v_eb uuid; v_ec uuid; v_ed uuid; v_pa uuid; v_pb uuid; v_ca uuid; v_ca2 uuid; v_ca3 uuid; v_cb uuid; v_cc uuid; v_cd uuid;
  v_va uuid; v_va2 uuid; v_sa uuid; v_sa_other uuid; v_sa2 uuid; v_vb uuid; v_sb uuid;
  l1 uuid; l2 uuid; l3 uuid; l_other uuid; l_v2 uuid; l_b uuid;
  v_res jsonb; v_got text; v_exp text; v_n bigint; v_sum numeric; v_before text; v_rows jsonb; v_conn_before text; i int;
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

  -- ── 1. The plan-line list gains Cash and bank, outside the P&L ──
  PERFORM fpa_test.as_user('user_viewerA');
  v_got := fpa_test.val('SELECT format(''%s|%s|%s|%s|%s|%s'', key, label, kind, sort_order, display_sign, mappable::text) || ''|'' || budgetable FROM fpa.plan_line_defs WHERE key = ''cash_bank''');
  PERFORM fpa_test.check(v_got = 'cash_bank|Cash and bank|balance|140|1|true|false', 'Cash and bank: kind balance, sort 140, display sign +1, mappable, not budgetable', v_got);
  PERFORM fpa_test.check(fpa_test.val('SELECT count(*)::text FROM fpa.plan_line_defs') = '14', 'plan_line_defs now has 14 lines (13 + Cash and bank)');
  v_got := fpa_test.val('SELECT string_agg(key, '','' ORDER BY sort_order) FROM fpa.plan_line_defs WHERE mappable');
  PERFORM fpa_test.check(v_got = 'revenue,cost_of_sales,payroll,marketing,premises,other_operating,interest,tax,excluded,cash_bank', 'mappable lines: the Phase 1 ones and Cash and bank', v_got);
  v_got := fpa_test.val('SELECT string_agg(key, '','' ORDER BY sort_order) FROM fpa.plan_line_defs WHERE budgetable');
  PERFORM fpa_test.check(v_got = 'revenue,cost_of_sales,payroll,marketing,premises,other_operating,interest,tax', 'budgetable lines unchanged (Cash and bank is not one)', v_got);
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.attempt('INSERT INTO fpa.plan_line_defs (key, label, kind, sort_order, display_sign) VALUES (''x'', ''X'', ''balance'', 999, 1)');
    PERFORM fpa_test.check(v_got = '42501', 'plan_line_defs insert refused as ' || v_who[i], v_got);
  END LOOP;

  -- ── 2. balances_monthly: no direct writes by any API role ──
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.attempt(format('INSERT INTO fpa.balances_monthly (entity_id, connection_id, account_code, period, closing_balance) VALUES (%L, %L, ''1200'', ''2025-01-01'', 1)', v_ea, v_ca));
    PERFORM fpa_test.check(v_got = '42501', 'balances_monthly direct insert refused as ' || v_who[i], v_got);
    v_got := fpa_test.attempt('UPDATE fpa.balances_monthly SET closing_balance = 0');
    PERFORM fpa_test.check(v_got = '42501', 'balances_monthly direct update refused as ' || v_who[i], v_got);
    v_got := fpa_test.attempt('DELETE FROM fpa.balances_monthly');
    PERFORM fpa_test.check(v_got = '42501', 'balances_monthly direct delete refused as ' || v_who[i], v_got);
  END LOOP;

  -- ── 3. import_balances: who may import ──
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''b.csv'')', v_ea, v_ca, jsonb_build_array(fpa_test.r('1200', '2025-01-01', '100.00'))));
    PERFORM fpa_test.check(v_got = e_edit[i], 'import_balances as ' || v_who[i], v_got);
  END LOOP;
  PERFORM fpa_test.as_user('authenticated');
  v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''b.csv'')', v_ea, v_ca, jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1'))));
  PERFORM fpa_test.check(v_got = 'PT401', 'import_balances with no user id: PT401', v_got);
  -- Cross-entity and connection checks.
  PERFORM fpa_test.as_user('user_ownerB');
  v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''b.csv'')', v_eb, v_ca, jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1'))));
  PERFORM fpa_test.check(v_got = 'PT404', 'B''s owner using A''s connection through B''s entity: PT404', v_got);
  PERFORM fpa_test.as_user('user_ownerA');
  v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''b.csv'')', v_ea, v_cb, jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1'))));
  PERFORM fpa_test.check(v_got = 'PT404', 'A''s owner using B''s connection: PT404', v_got);
  v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''b.csv'')', v_ea, v_ca2, jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1'))));
  PERFORM fpa_test.check(v_got = 'PT400', 'a non-CSV connection: PT400', v_got);
  v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''b.csv'')', v_ea, v_ca3, jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1'))));
  PERFORM fpa_test.check(v_got = 'PT409', 'a disabled connection: PT409', v_got);

  -- ── 4. Whole-month replace, sync log kind, connection untouched ──
  PERFORM fpa_test.as_user('user_ownerA');
  -- P&L actuals first (they set the connection's dates), so the balances import can be seen to leave them alone.
  PERFORM fpa.import_actuals(v_ea, v_ca, jsonb_build_array(
    fpa_test.r('4000', '2025-01-01', '-1000.00', 'Sales'), fpa_test.r('5000', '2025-01-01', '400.00', 'Wages'), fpa_test.r('1200', '2025-01-01', '250.00', 'Bank current account'),
    fpa_test.r('4000', '2025-02-01', '-1100.00', 'Sales'), fpa_test.r('5000', '2025-02-01', '420.00', 'Wages'), fpa_test.r('1200', '2025-02-01', '-80.00', 'Bank current account'),
    fpa_test.r('4000', '2025-03-01', '-1200.00', 'Sales'), fpa_test.r('5000', '2025-03-01', '430.00', 'Wages'), fpa_test.r('1200', '2025-03-01', '120.00', 'Bank current account')), 'pl.csv');
  PERFORM fpa_test.as_postgres();
  SELECT format('%s|%s|%s', c.actuals_through, c.last_synced_at, c.status) INTO v_conn_before FROM fpa.connections c WHERE c.id = v_ca;
  PERFORM fpa_test.as_user('user_editorA');
  v_res := fpa.import_balances(v_ea, v_ca, jsonb_build_array(
    fpa_test.r('1200', '2025-01-01', '10000.00', 'Bank current account'), fpa_test.r('1210', '2025-01-01', '5000.00', 'Bank deposit'), fpa_test.r('1100', '2025-01-01', '3000.00', 'Trade debtors'),
    fpa_test.r('1200', '2025-02-01', '9000.00', 'Bank current account'), fpa_test.r('1210', '2025-02-01', '5000.00', 'Bank deposit'), fpa_test.r('1100', '2025-02-01', '3500.00', 'Trade debtors'),
    fpa_test.r('1200', '2025-03-01', '8000.00', 'Bank current account'), fpa_test.r('1210', '2025-03-01', '5000.00', 'Bank deposit'), fpa_test.r('1100', '2025-03-01', '4000.00', 'Trade debtors')), 'balances-q1.csv');
  PERFORM fpa_test.check(v_res ->> 'rows_added' = '9' AND v_res ->> 'rows_removed' = '0' AND v_res ->> 'balances_through' = '2025-03-01'
    AND v_res -> 'months_replaced' = '["2025-01-01", "2025-02-01", "2025-03-01"]'::jsonb, 'first balances import: 9 added, 0 removed, through 2025-03', v_res::text);
  -- Re-import February (1210 gone, 1200 changed) and add April.
  v_res := fpa.import_balances(v_ea, v_ca, jsonb_build_array(
    fpa_test.r('1200', '2025-02-01', '9100.00'), fpa_test.r('1100', '2025-02-01', '3500.00'),
    fpa_test.r('1200', '2025-04-01', '7000.00'), fpa_test.r('1210', '2025-04-01', '5000.00'), fpa_test.r('1100', '2025-04-01', '4200.00')), 'balances-feb-apr.csv');
  PERFORM fpa_test.check(v_res ->> 'rows_added' = '5' AND v_res ->> 'rows_removed' = '3' AND v_res ->> 'balances_through' = '2025-04-01',
    'second import: February replaced whole (3 removed), April added; 5 added', v_res::text);
  PERFORM fpa_test.as_postgres();
  v_got := (SELECT string_agg(format('%s %s %s', to_char(b.period, 'YYYY-MM'), b.account_code, b.closing_balance), ',' ORDER BY b.period, b.account_code) FROM fpa.balances_monthly b WHERE b.entity_id = v_ea);
  PERFORM fpa_test.check(v_got = '2025-01 1100 3000.00,2025-01 1200 10000.00,2025-01 1210 5000.00,2025-02 1100 3500.00,2025-02 1200 9100.00,'
    '2025-03 1100 4000.00,2025-03 1200 8000.00,2025-03 1210 5000.00,2025-04 1100 4200.00,2025-04 1200 7000.00,2025-04 1210 5000.00',
    'January and March untouched; February replaced exactly (1210 gone); April added', v_got);
  v_got := (SELECT string_agg(format('%s:%s:%s:%s', s.kind, s.rows_added, s.rows_removed, s.source_name), ',' ORDER BY s.kind, s.source_name) FROM fpa.sync_runs s WHERE s.entity_id = v_ea);
  PERFORM fpa_test.check(v_got = 'actuals:9:0:pl.csv,balances:5:3:balances-feb-apr.csv,balances:9:0:balances-q1.csv',
    'sync_runs: the P&L import is kind actuals (the default), the two balance imports kind balances', v_got);
  PERFORM fpa_test.check((SELECT format('%s|%s|%s', c.actuals_through, c.last_synced_at, c.status) FROM fpa.connections c WHERE c.id = v_ca) = v_conn_before,
    'the connection''s actuals_through, last_synced_at and status are unchanged by balance imports', v_conn_before);
  PERFORM fpa_test.check((SELECT count(*) FROM fpa.actuals_monthly a WHERE a.entity_id = v_ea) = 9, 'P&L actuals unchanged by balance imports');

  -- Reads: viewer and above see A's April rows; others none.
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.val('SELECT count(*)::text FROM fpa.balances_monthly WHERE period >= ''2025-03-01''');
    v_exp := CASE WHEN i <= 3 THEN '6' WHEN i <= 6 THEN '0' ELSE '42501' END;
    PERFORM fpa_test.check(v_got = v_exp, 'balances_monthly read as ' || v_who[i], v_got);
  END LOOP;

  -- ── 5. Atomicity ──
  PERFORM fpa_test.as_postgres();
  SELECT count(*), sum(b.closing_balance) INTO v_n, v_sum FROM fpa.balances_monthly b WHERE b.entity_id = v_ea;
  PERFORM fpa_test.as_user('user_ownerA');
  PERFORM set_config('fpa_test.fail_sync_run', 'on', true);
  v_got := fpa_test.try_msg(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''fail.csv'')', v_ea, v_ca, jsonb_build_array(fpa_test.r('1200', '2025-03-01', '1.00'), fpa_test.r('1200', '2025-04-01', '2.00'))));
  PERFORM set_config('fpa_test.fail_sync_run', 'off', true);
  PERFORM fpa_test.check(v_got LIKE '%injected failure writing the sync log%', 'an injected failure at the last step reaches the caller', v_got);
  PERFORM set_config('fpa_test.fail_account', 'FAILHERE', true);
  v_got := fpa_test.try_msg(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''fail2.csv'')', v_ea, v_ca, jsonb_build_array(fpa_test.r('1200', '2025-03-01', '1.00'), fpa_test.r('FAILHERE', '2025-03-01', '2.00'), fpa_test.r('1100', '2025-03-01', '3.00'))));
  PERFORM set_config('fpa_test.fail_account', '', true);
  PERFORM fpa_test.check(v_got LIKE '%injected failure at account FAILHERE%', 'an injected failure midway through the inserts reaches the caller', v_got);
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check((SELECT count(*) FROM fpa.balances_monthly b WHERE b.entity_id = v_ea) = v_n AND (SELECT sum(b.closing_balance) FROM fpa.balances_monthly b WHERE b.entity_id = v_ea) = v_sum
    AND (SELECT count(*) FROM fpa.sync_runs s WHERE s.entity_id = v_ea) = 3, 'after both failures: the replaced months came back exactly, nothing logged', format('%s rows, sum %s', v_n, v_sum));

  -- ── 6. Limits and bad input (each refused, nothing changed) ──
  PERFORM fpa_test.as_user('user_ownerA');
  v_rows := (SELECT jsonb_agg(fpa_test.r('A' || g, '2025-01-01', '1.00')) FROM generate_series(1, 20001) g);
  v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''big.csv'')', v_ea, v_ca, v_rows));
  PERFORM fpa_test.check(v_got = 'PT413', '20,001 rows: PT413', v_got);
  v_rows := (SELECT jsonb_agg(fpa_test.r('A' || g, '2025-01-01', '1.00', repeat('N', 200))) FROM generate_series(1, 19000) g);
  v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''fat.csv'')', v_ea, v_ca, v_rows));
  PERFORM fpa_test.check(v_got = 'PT413', 'more than 5 MB of rows: PT413', v_got);
  FOR v_got, v_exp IN SELECT x.payload, x.label FROM (VALUES
      (jsonb_build_array(fpa_test.r('1200', '2025-01-15', '1')), 'a mid-month date'),
      (jsonb_build_array(fpa_test.r('1200', '2025-13-01', '1')), 'month 13'),
      (jsonb_build_array(fpa_test.r('1200', '1999-12-01', '1')), 'before 2000'),
      (jsonb_build_array(fpa_test.r('1200', to_char(date_trunc('month', now()) + interval '1 month', 'YYYY-MM-DD'), '1')), 'a future month'),
      (jsonb_build_array(fpa_test.r('1200', '2025-01-01', 'NaN')), 'NaN'),
      (jsonb_build_array(fpa_test.r('1200', '2025-01-01', 'Infinity')), 'Infinity'),
      (jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1.234')), 'three decimals'),
      (jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1e5')), 'an exponent'),
      (jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1234567890123.00')), '13 digits'),
      (jsonb_build_array(fpa_test.r('', '2025-01-01', '1')), 'an empty account code'),
      (jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1'), fpa_test.r('1200', '2025-01-01', '2')), 'the same account and month twice'),
      (jsonb_build_array(jsonb_build_object('account_code', '1200', 'month', '2025-01-01', 'amount', '1', 'extra', 'x')), 'an unknown field'),
      ('[]'::jsonb, 'no rows'),
      ('{"a": 1}'::jsonb, 'not a list')) x(payload, label)
  LOOP
    v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''bad.csv'')', v_ea, v_ca, v_got));
    PERFORM fpa_test.check(v_got = 'PT400', 'refused: ' || v_exp, v_got);
  END LOOP;
  v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, '' '')', v_ea, v_ca, jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1'))));
  PERFORM fpa_test.check(v_got = 'PT400', 'refused: an empty file name', v_got);
  v_got := fpa_test.try_msg(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''bad.csv'')', v_ea, v_ca, jsonb_build_array(fpa_test.r('1200', '2025-01-01', '1'), fpa_test.r('1210', '2025-01-01', 'abc'))));
  PERFORM fpa_test.check(v_got LIKE '%Row 2: the balance must be a number%', 'the error names the row', v_got);
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check((SELECT count(*) FROM fpa.balances_monthly b WHERE b.entity_id = v_ea) = v_n AND (SELECT count(*) FROM fpa.sync_runs s WHERE s.entity_id = v_ea) = 3,
    'nothing changed after any refusal');
  -- Exactly 20,000 rows is accepted (in B, undone straight after, so A's figures below are not affected).
  PERFORM fpa_test.as_user('user_ownerB');
  v_rows := (SELECT jsonb_agg(fpa_test.r('Z' || a, to_char(DATE '2023-01-01' + make_interval(months => m), 'YYYY-MM-DD'), '1.00')) FROM generate_series(1, 2000) a, generate_series(0, 9) m);
  v_got := fpa_test.attempt(format('SELECT fpa.import_balances(%L, %L, %L::jsonb, ''max.csv'')', v_eb, v_cb, v_rows));
  PERFORM fpa_test.check(v_got = 'ok:1', 'exactly 20,000 rows: accepted', v_got);

  -- ── 7. balance_accounts ──
  PERFORM fpa_test.as_user('user_editorA');
  PERFORM fpa.set_line_map(v_ca, '[{"account_code": "1200", "plan_line": "cash_bank"}, {"account_code": "1100", "plan_line": "excluded"}]'::jsonb);
  PERFORM fpa_test.as_user('user_viewerA');
  v_got := fpa_test.val(format('SELECT string_agg(format(''%%s:%%s:%%s:%%s:%%s'', account_code, coalesce(account_name, ''-''), coalesce(plan_line, ''-''), months, last_balance), '','') FROM fpa.balance_accounts(%L)', v_ea));
  PERFORM fpa_test.check(v_got = '1210:Bank deposit:-:3:5000.00,1100:Trade debtors:excluded:4:4200.00,1200:Bank current account:cash_bank:4:7000.00',
    'balance_accounts: unmapped first, then by code; latest name and balance; months counted', v_got);
  FOR i IN 4 .. 6 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    PERFORM fpa_test.check(fpa_test.val(format('SELECT count(*)::text FROM fpa.balance_accounts(%L)', v_ea)) = '0', 'balance_accounts gives no rows as ' || v_who[i]);
  END LOOP;
  FOR i IN 7 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    PERFORM fpa_test.check(fpa_test.val(format('SELECT count(*)::text FROM fpa.balance_accounts(%L)', v_ea)) = '42501', 'balance_accounts refused as ' || v_who[i]);
  END LOOP;

  -- ── 8. cash_position against hand-computed figures ──
  -- Entity C: balances for 2025-06 to 2025-10. 1200 and 1210 are Cash and bank; 1100 is excluded and
  -- 2200 is unmapped (neither counts); 1250 is Cash and bank but has no row in August (0 that month);
  -- 1220 is an overdraft (Cash and bank, credit balance, so it lowers cash).
  --   month  1200     1210    1220      1250   (1100, 2200 ignored)   cash
  --   06     12000.00 3000.00 -500.00   50.00                         14550.00
  --   07     11000.00 3000.00 -400.00   40.00                         13640.00
  --   08      9500.50 3000.00 -300.00   (none)                        12200.50
  --   09      8000.25 3000.00 -200.00   30.00                         10830.25
  --   10      7200.00 2500.00    0.00   25.00                          9725.00
  PERFORM fpa_test.as_user('user_ownerC');
  v_ec := fpa.create_entity('Charlie Test Ltd', 'IE', 'EUR', 1::smallint);
  PERFORM fpa.add_member(v_ec, 'user_viewerC', 'viewer');
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_ec, 'csv') RETURNING id INTO v_cc;
  PERFORM fpa_test.check(fpa_test.cash(v_ec) = 'none', 'cash_position with no balances: no rows', fpa_test.cash(v_ec));
  PERFORM fpa.import_balances(v_ec, v_cc, jsonb_build_array(
    fpa_test.r('1200', '2025-06-01', '12000.00'), fpa_test.r('1210', '2025-06-01', '3000.00'), fpa_test.r('1220', '2025-06-01', '-500.00'), fpa_test.r('1250', '2025-06-01', '50.00'),
    fpa_test.r('1100', '2025-06-01', '999.99'), fpa_test.r('2200', '2025-06-01', '-777.77'),
    fpa_test.r('1200', '2025-07-01', '11000.00'), fpa_test.r('1210', '2025-07-01', '3000.00'), fpa_test.r('1220', '2025-07-01', '-400.00'), fpa_test.r('1250', '2025-07-01', '40.00'),
    fpa_test.r('1100', '2025-07-01', '888.88'),
    fpa_test.r('1200', '2025-08-01', '9500.50'), fpa_test.r('1210', '2025-08-01', '3000.00'), fpa_test.r('1220', '2025-08-01', '-300.00'),
    fpa_test.r('1100', '2025-08-01', '777.77'),
    fpa_test.r('1200', '2025-09-01', '8000.25'), fpa_test.r('1210', '2025-09-01', '3000.00'), fpa_test.r('1220', '2025-09-01', '-200.00'), fpa_test.r('1250', '2025-09-01', '30.00'),
    fpa_test.r('1100', '2025-09-01', '666.66'), fpa_test.r('2200', '2025-09-01', '-555.55'),
    fpa_test.r('1200', '2025-10-01', '7200.00'), fpa_test.r('1210', '2025-10-01', '2500.00'), fpa_test.r('1220', '2025-10-01', '0.00'), fpa_test.r('1250', '2025-10-01', '25.00'),
    fpa_test.r('1100', '2025-10-01', '555.55'), fpa_test.r('2200', '2025-10-01', '-444.44')), 'c.csv');
  -- Before any mapping: no cash account, so every month with balances has cash 0 (not null), and all
  -- six latest-month accounts are unmapped.
  v_got := fpa_test.cash(v_ec);
  PERFORM fpa_test.check(v_got = '2025-10-01|5|6 2025-10:true:0 2025-09:true:0 2025-08:true:0 2025-07:true:0 2025-06:true:0',
    'cash_position before mapping: cash 0 in each month with balances; 6 unmapped', v_got);
  PERFORM fpa.set_line_map(v_cc, '[{"account_code": "1200", "plan_line": "cash_bank"}, {"account_code": "1210", "plan_line": "cash_bank"},
    {"account_code": "1220", "plan_line": "cash_bank"}, {"account_code": "1250", "plan_line": "cash_bank"}, {"account_code": "1100", "plan_line": "excluded"}]'::jsonb);
  v_got := fpa_test.cash(v_ec);
  PERFORM fpa_test.check(v_got = '2025-10-01|5|1 2025-10:true:9725.00 2025-09:true:10830.25 2025-08:true:12200.50 2025-07:true:13640.00 2025-06:true:14550.00',
    'cash_position matches the hand-computed table (excluded and unmapped accounts not counted; overdraft lowers cash; a missing cash row is 0)', v_got);
  PERFORM fpa_test.as_user('user_viewerC');
  PERFORM fpa_test.check(fpa_test.cash(v_ec) = v_got, 'a viewer gets the same cash position');
  FOR i IN 1 .. 6 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    PERFORM fpa_test.check(fpa_test.val(format('SELECT count(*)::text FROM fpa.cash_position(%L)', v_ec)) = '0', 'cash_position of C gives no rows as ' || v_who[i]);
  END LOOP;
  FOR i IN 7 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    PERFORM fpa_test.check(fpa_test.val(format('SELECT count(*)::text FROM fpa.cash_position(%L)', v_ec)) = '42501', 'cash_position refused as ' || v_who[i]);
  END LOOP;
  -- Entity D: a month never imported is NULL, not zero (August missing).
  PERFORM fpa_test.as_user('user_ownerC');
  v_ed := fpa.create_entity('Delta Test Ltd', 'IE', 'EUR', 1::smallint);
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_ed, 'csv') RETURNING id INTO v_cd;
  PERFORM fpa.import_balances(v_ed, v_cd, jsonb_build_array(
    fpa_test.r('1200', '2025-06-01', '100.00'), fpa_test.r('1200', '2025-07-01', '90.00'), fpa_test.r('1200', '2025-09-01', '70.00'), fpa_test.r('1200', '2025-10-01', '60.00')), 'd.csv');
  PERFORM fpa.set_line_map(v_cd, '[{"account_code": "1200", "plan_line": "cash_bank"}]'::jsonb);
  v_got := fpa_test.cash(v_ed);
  PERFORM fpa_test.check(v_got = '2025-10-01|4|0 2025-10:true:60.00 2025-09:true:70.00 2025-08:false:null 2025-07:true:90.00 2025-06:true:100.00',
    'a month never imported has no cash (null), not zero; months_available counts only imported months', v_got);
  -- A's cash position (1200 mapped to Cash and bank in section 7; latest month 2025-04).
  PERFORM fpa_test.as_user('user_ownerA');
  v_got := fpa_test.cash(v_ea);
  PERFORM fpa_test.check(v_got = '2025-04-01|4|1 2025-04:true:7000.00 2025-03:true:8000.00 2025-02:true:9100.00 2025-01:true:10000.00 2024-12:false:null',
    'A''s cash position: 1200 only (1210 unmapped, 1100 excluded); the month before the first import has no cash (null)', v_got);

  -- ── 9. Variance leaves Cash and bank out; nothing else changes ──
  PERFORM fpa_test.as_user('user_ownerA');
  PERFORM fpa.set_line_map(v_ca, '[{"account_code": "4000", "plan_line": "revenue"}, {"account_code": "5000", "plan_line": "payroll"}]'::jsonb);
  -- In A, 1200 has P&L actuals and is now mapped to Cash and bank.
  PERFORM fpa_test.check((SELECT count(*) FROM fpa.variance(v_ea, NULL, '2025-01-01', '2025-03-01') v WHERE v.line_key = 'cash_bank') = 0
    AND (SELECT count(*) FROM fpa.variance(v_ea, NULL, '2025-01-01', '2025-03-01')) = 36, 'variance has no Cash and bank line: still 12 lines x 3 months');
  PERFORM fpa_test.check(NOT EXISTS (SELECT * FROM fpa.variance(v_ea, NULL, '2025-01-01', '2025-03-01')
                                     EXCEPT SELECT * FROM fpa_test.variance_0003(v_ea, NULL, '2025-01-01', '2025-03-01'))
    AND NOT EXISTS (SELECT * FROM fpa_test.variance_0003(v_ea, NULL, '2025-01-01', '2025-03-01') WHERE line_key <> 'cash_bank'
                    EXCEPT SELECT * FROM fpa.variance(v_ea, NULL, '2025-01-01', '2025-03-01'))
    AND (SELECT count(*) FROM fpa_test.variance_0003(v_ea, NULL, '2025-01-01', '2025-03-01') WHERE line_key = 'cash_bank') = 3,
    'new variance = the 0003 variance minus its Cash and bank rows (which the 0003 text would have shown)');
  v_got := (SELECT string_agg(format('%s:%s', v.month, v.actual), ',' ORDER BY v.month) FROM fpa.variance(v_ea, NULL, '2025-01-01', '2025-03-01') v WHERE v.line_key = 'net_profit');
  PERFORM fpa_test.check(v_got = '2025-01-01:600.00,2025-02-01:680.00,2025-03-01:770.00', 'net profit leaves out the account mapped to Cash and bank (revenue less wages only)', v_got);
  -- With no account on Cash and bank, the two agree on every line; the 0003 text would still show a
  -- Cash and bank line (all zeros), because it keeps every line that is not 'excluded'.
  PERFORM fpa.set_line_map(v_ca, '[{"account_code": "1200", "plan_line": "excluded"}]'::jsonb);
  PERFORM fpa_test.check(NOT EXISTS ((SELECT * FROM fpa.variance(v_ea, NULL, '2025-01-01', '2025-03-01') EXCEPT SELECT * FROM fpa_test.variance_0003(v_ea, NULL, '2025-01-01', '2025-03-01'))
                    UNION ALL (SELECT * FROM fpa_test.variance_0003(v_ea, NULL, '2025-01-01', '2025-03-01') WHERE line_key <> 'cash_bank'
                               EXCEPT SELECT * FROM fpa.variance(v_ea, NULL, '2025-01-01', '2025-03-01')))
    AND (SELECT string_agg(coalesce(v.actual::text, 'null'), ',' ORDER BY v.month) FROM fpa_test.variance_0003(v_ea, NULL, '2025-01-01', '2025-03-01') v WHERE v.line_key = 'cash_bank') = '0,0,0',
    'with no account on Cash and bank, new and 0003 variance agree on every line (0003 would add a zero Cash and bank line)');
  PERFORM fpa.set_line_map(v_ca, '[{"account_code": "1200", "plan_line": "cash_bank"}]'::jsonb);
  -- Budgets never carry Cash and bank.
  v_got := fpa_test.attempt(format('SELECT fpa.create_budget_from_actuals(%L, NULL, ''X'', ''2025-01-01'', ''2026-01-01'', ''{"cash_bank": 5}''::jsonb)', v_pa));
  PERFORM fpa_test.check(v_got = 'PT400', 'an uplift for Cash and bank is refused (not a budget line)', v_got);

  -- ── 10. save_budget_lines ──
  PERFORM fpa_test.as_user('user_ownerA');
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_pa, 'budget', 'Alpha budget') RETURNING id INTO v_va;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_va, 'Base', true) RETURNING id INTO v_sa;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_va, 'Upside', false) RETURNING id INTO v_sa_other;
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (v_va, v_sa, 'revenue', '2026-01-01', -1000, 'from_actuals') RETURNING id INTO l1;
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (v_va, v_sa, 'payroll', '2026-01-01', 400, 'from_actuals') RETURNING id INTO l2;
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (v_va, v_sa, 'revenue', '2026-02-01', -1100, 'manual') RETURNING id INTO l3;
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (v_va, v_sa_other, 'revenue', '2026-01-01', -1500, 'manual') RETURNING id INTO l_other;
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_pa, 'budget', 'Alpha budget 2') RETURNING id INTO v_va2;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_va2, 'Base', true) RETURNING id INTO v_sa2;
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (v_va2, v_sa2, 'revenue', '2026-01-01', -9, 'from_actuals') RETURNING id INTO l_v2;
  PERFORM fpa_test.as_user('user_ownerB');
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_pb, 'budget', 'Bravo budget') RETURNING id INTO v_vb;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_vb, 'Base', true) RETURNING id INTO v_sb;
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (v_vb, v_sb, 'revenue', '2026-01-01', -7, 'from_actuals') RETURNING id INTO l_b;
  -- Who may save.
  FOR i IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[i]);
    v_got := fpa_test.attempt(format('SELECT fpa.save_budget_lines(%L, %L::jsonb)', v_va, jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1200.00'))));
    PERFORM fpa_test.check(v_got = e_edit[i], 'save_budget_lines as ' || v_who[i], v_got);
  END LOOP;
  -- A good save: two lines, amounts and origin set, count returned.
  PERFORM fpa_test.as_user('user_editorA');
  v_got := fpa_test.val(format('SELECT fpa.save_budget_lines(%L, %L::jsonb)::text', v_va,
    jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1250.50'), jsonb_build_object('id', l2, 'amount', 410))));
  PERFORM fpa_test.check(v_got = '2', 'an editor saves two lines: returns 2', v_got);
  PERFORM fpa_test.as_postgres();
  v_got := (SELECT string_agg(format('%s:%s:%s', l.plan_line, l.amount, l.origin), ',' ORDER BY l.plan_line, l.period) FROM fpa.plan_lines l WHERE l.id IN (l1, l2, l3));
  PERFORM fpa_test.check(v_got = 'payroll:410.00:manual,revenue:-1250.50:manual,revenue:-1100.00:manual', 'amounts set and origin manual; the untouched line unchanged', v_got);
  -- All or nothing: one good line and one bad line saves neither.
  PERFORM fpa_test.as_user('user_editorA');
  FOR v_rows, v_exp IN SELECT x.payload, x.label FROM (VALUES
      (jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00'), jsonb_build_object('id', l_v2, 'amount', '-2.00')), 'a line from another version'),
      (jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00'), jsonb_build_object('id', l_other, 'amount', '-2.00')), 'a line from a non-base scenario'),
      (jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00'), jsonb_build_object('id', l_b, 'amount', '-2.00')), 'a line of another entity''s budget'),
      (jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00'), jsonb_build_object('id', gen_random_uuid(), 'amount', '-2.00')), 'a line that does not exist'),
      (jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00'), jsonb_build_object('id', l2, 'amount', '1.234')), 'three decimals'),
      (jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00'), jsonb_build_object('id', l2, 'amount', 'NaN')), 'NaN'),
      (jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00'), jsonb_build_object('id', l1, 'amount', '-2.00')), 'the same line twice'),
      (jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00', 'origin', 'actual')), 'an unknown field'),
      (jsonb_build_array(jsonb_build_object('id', 'not-a-uuid', 'amount', '-1.00')), 'an id that is not a line id'),
      ('[]'::jsonb, 'no lines'),
      ((SELECT jsonb_agg(jsonb_build_object('id', l1, 'amount', '1')) FROM generate_series(1, 1201)), '1,201 lines')) x(payload, label)
  LOOP
    v_got := fpa_test.attempt(format('SELECT fpa.save_budget_lines(%L, %L::jsonb)', v_va, v_rows));
    PERFORM fpa_test.check(v_got = 'PT400', 'save refused: ' || v_exp, v_got);
  END LOOP;
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check((SELECT string_agg(format('%s:%s', l.amount, l.origin), ',' ORDER BY l.plan_line) FROM fpa.plan_lines l WHERE l.id IN (l1, l2)) = '410.00:manual,-1250.50:manual'
    AND (SELECT amount FROM fpa.plan_lines WHERE id = l_v2) = -9 AND (SELECT amount FROM fpa.plan_lines WHERE id = l_other) = -1500 AND (SELECT amount FROM fpa.plan_lines WHERE id = l_b) = -7,
    'after every refusal nothing was saved (all or nothing), in this or any other version');
  -- B's owner using A's version, and A's editor using B's version.
  PERFORM fpa_test.as_user('user_ownerB');
  v_got := fpa_test.attempt(format('SELECT fpa.save_budget_lines(%L, %L::jsonb)', v_va, jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00'))));
  PERFORM fpa_test.check(v_got = 'PT403', 'B''s owner saving into A''s budget: PT403', v_got);
  PERFORM fpa_test.as_user('user_editorA');
  v_got := fpa_test.attempt(format('SELECT fpa.save_budget_lines(%L, %L::jsonb)', v_vb, jsonb_build_array(jsonb_build_object('id', l_b, 'amount', '-1.00'))));
  PERFORM fpa_test.check(v_got = 'PT403', 'A''s editor saving into B''s budget: PT403', v_got);
  -- Locked: refused with PT423, nothing changed; and still owner-only unlock (Phase 0 rule).
  UPDATE fpa.plan_versions SET locked_at = now() WHERE id = v_va;
  v_got := fpa_test.attempt(format('SELECT fpa.save_budget_lines(%L, %L::jsonb)', v_va, jsonb_build_array(jsonb_build_object('id', l1, 'amount', '-1.00'))));
  PERFORM fpa_test.check(v_got = 'PT423', 'a locked budget: PT423', v_got);
  v_got := fpa_test.attempt(format('UPDATE fpa.plan_versions SET locked_at = NULL WHERE id = %L', v_va));
  PERFORM fpa_test.check(v_got = 'PT403', 'an editor still cannot unlock (owner only)', v_got);
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check((SELECT amount FROM fpa.plan_lines WHERE id = l1) = -1250.50, 'the locked budget''s line is unchanged');

  -- ── 11. Privileges and structure ──
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(
    NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
                  AND p.proname IN ('import_balances', 'balance_accounts', 'cash_position', 'save_budget_lines', 'variance')
                  AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')
                       OR EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')))
    AND (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
           AND p.proname IN ('import_balances', 'balance_accounts', 'cash_position', 'save_budget_lines', 'variance')),
    'the new functions and variance: executable by authenticated only (not PUBLIC, anon or service_role)');
  PERFORM fpa_test.check(
    (SELECT string_agg(p.proname || ':' || p.prosecdef || ':' || coalesce(p.proconfig::text LIKE '%search_path=fpa, pg_temp%', false), ',' ORDER BY p.proname)
       FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND p.proname IN ('import_balances', 'balance_accounts', 'cash_position', 'save_budget_lines'))
      = 'balance_accounts:false:true,cash_position:false:true,import_balances:true:true,save_budget_lines:false:true',
    'import_balances is SECURITY DEFINER; the other three run as the caller; all have a fixed search_path');
  PERFORM fpa_test.check(NOT has_table_privilege('authenticated', 'fpa.balances_monthly', 'INSERT') AND NOT has_table_privilege('authenticated', 'fpa.balances_monthly', 'UPDATE')
    AND NOT has_table_privilege('authenticated', 'fpa.balances_monthly', 'DELETE') AND has_table_privilege('authenticated', 'fpa.balances_monthly', 'SELECT')
    AND NOT has_table_privilege('anon', 'fpa.balances_monthly', 'SELECT') AND NOT has_table_privilege('service_role', 'fpa.balances_monthly', 'SELECT'),
    'balances_monthly: SELECT for authenticated only; no writes for any API role');
  PERFORM fpa_test.check((SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity) = 17
    AND (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r') = 17
    AND (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'fpa') = 43 AND (SELECT bool_and(p.roles = '{authenticated}') FROM pg_policies p WHERE p.schemaname = 'fpa')
    AND (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace) = 31,
    '17 tables all with row security; 43 policies all TO authenticated; 31 functions');
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.connamespace = 'fpa'::regnamespace AND k.contype = 'f' AND k.confrelid::regclass::text NOT LIKE 'fpa.%')
    AND NOT has_schema_privilege('anon', 'fpa', 'USAGE') AND NOT has_schema_privilege('service_role', 'fpa', 'USAGE'),
    'no foreign key leaves fpa; anon and service_role still have no schema access');
END $test$;

-- Report: failures, pass count, and the privilege evidence for what 0004 adds or changes (kept short:
-- the connector cuts error messages longer than about 10,000 characters).
DO $report$
DECLARE v_fail text; v_pass int; v_fails int; v_out text;
BEGIN
  SELECT count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass),
         string_agg(CASE WHEN NOT pass THEN label || coalesce(' [got ' || detail || ']', '') END, ' | ' ORDER BY n)
    INTO v_pass, v_fails, v_fail FROM fpa_test.results;
  v_out := format(E'%s failure(s), %s pass(es)%s\n', v_fails, v_pass, CASE WHEN v_fails > 0 THEN E'\nFAILED: ' || v_fail ELSE '' END);
  v_out := v_out || E'\n== Tables 0004 adds or changes: row security and ACL, less the owner entry ==\n'
    || (SELECT string_agg(format('%s: rls=%s %s', c.relname, c.relrowsecurity,
          coalesce(nullif(array_to_string(ARRAY(SELECT x::text FROM unnest(c.relacl) x WHERE x::text <> 'postgres=arwdDxtm/postgres'), ','), ''), '(owner only)')), E'\n' ORDER BY c.relname)
        FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND c.relname IN ('balances_monthly', 'plan_line_defs', 'sync_runs'));
  v_out := v_out || E'\n\n== Policies 0004 adds ==\n'
    || (SELECT string_agg(format('%s %s to %s using %s', p.policyname, p.cmd, array_to_string(p.roles, ','), replace(p.qual, 'fpa.', '')), E'\n' ORDER BY p.policyname)
        FROM pg_policies p WHERE p.schemaname = 'fpa' AND p.tablename = 'balances_monthly')
    || E'\nAll policies in fpa: ' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'fpa')::text || ', all TO authenticated only: '
    || (SELECT bool_and(p.roles = '{authenticated}'::name[]) FROM pg_policies p WHERE p.schemaname = 'fpa')::text;
  v_out := v_out || E'\n\n== New and replaced functions: ACL, security, volatility, EXECUTE by role ==\n' || (SELECT string_agg(format('%s: definer=%s %s acl=%s | anon=%s authenticated=%s service_role=%s PUBLIC=%s',
        p.oid::regprocedure, p.prosecdef, CASE p.provolatile WHEN 's' THEN 'stable' WHEN 'i' THEN 'immutable' ELSE 'volatile' END, coalesce(array_to_string(p.proacl, ','), '(default)'),
        has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('service_role', p.oid, 'EXECUTE'),
        EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')), E'\n' ORDER BY p.proname)
    FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND p.proname IN ('import_balances', 'balance_accounts', 'cash_position', 'save_budget_lines', 'variance'));
  v_out := v_out || E'\n\n== Verdict, all ' || (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace)::text || E' fpa functions ==\nExecutable by PUBLIC: '
    || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
        AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')), 'none')
    || E'\nExecutable by anon: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')), 'none')
    || E'\nExecutable by service_role: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('service_role', p.oid, 'EXECUTE')), 'none')
    || E'\nExecutable by authenticated: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), 'none');
  RAISE EXCEPTION '%', v_out;
END $report$;
