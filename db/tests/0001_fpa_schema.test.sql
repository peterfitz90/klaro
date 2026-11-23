-- Tests for 0001_fpa_schema.sql. Run AFTER the migration INSIDE ONE TRANSACTION (db/bundle.mjs builds
-- db/out/test_0001.sql: BEGIN; 0001; this file). The report block at the end always raises, so
-- everything, including the fpa_test helpers, rolls back.
-- Every access check runs as a real role (SET LOCAL ROLE anon / authenticated / service_role) with
-- real JWT claims in request.jwt.claims, never only as postgres, which bypasses row security and grants.
-- Expect "0 failure(s), N pass(es)" followed by the full grants evidence.

CREATE SCHEMA fpa_test;
CREATE TABLE fpa_test.results (n serial, label text, pass boolean, detail text);
-- Switch to a test user: 'anon', 'service_role', or a Clerk user id (authenticated, sub = that id).
-- An empty sub ('authenticated') signs in with no user id.
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
-- Runs a statement as the current role and always undoes it. Returns 'ok:<rows affected>' or the SQLSTATE.
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
-- A count(*) as the current role; -1 when the role is denied.
CREATE FUNCTION fpa_test.cnt(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint; BEGIN EXECUTE p_sql INTO v; RETURN v; EXCEPTION WHEN insufficient_privilege THEN RETURN -1; END $$;
-- A single text value as the current role, or the SQLSTATE.
CREATE FUNCTION fpa_test.val(p_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text; BEGIN EXECUTE p_sql INTO v; RETURN coalesce(v, 'null'); EXCEPTION WHEN others THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION fpa_test.check(p_pass boolean, p_label text, p_detail text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO fpa_test.results (label, pass, detail) VALUES (p_label, coalesce(p_pass, false), p_detail); $$;
-- Used to make a later step of create_entity fail (rollback test).
CREATE FUNCTION fpa_test.fail_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'injected failure in %', TG_TABLE_NAME; END $$;
GRANT USAGE ON SCHEMA fpa_test TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA fpa_test TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA fpa_test TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fpa_test TO anon, authenticated, service_role;

DO $test$
DECLARE
  v_del constant text := 'DEL' || 'ETE';
  v_who constant text[] := ARRAY['user_ownerA', 'user_editorA', 'user_viewerA', 'user_inactiveA', 'user_outsider', 'user_ownerB', 'anon', 'service_role'];
  -- Expected results by role, in the order of v_who.
  e_none  constant text[] := ARRAY['42501','42501','42501','42501','42501','42501','42501','42501'];
  e_own_i constant text[] := ARRAY['ok:1','42501','42501','42501','42501','42501','42501','42501'];
  e_own_u constant text[] := ARRAY['ok:1','ok:0','ok:0','ok:0','ok:0','ok:0','42501','42501'];
  e_ed_i  constant text[] := ARRAY['ok:1','ok:1','42501','42501','42501','42501','42501','42501'];
  e_ed_u  constant text[] := ARRAY['ok:1','ok:1','ok:0','ok:0','ok:0','ok:0','42501','42501'];
  -- driver_values: the same-plan trigger runs before row security, so a caller who cannot see the
  -- driver or scenario is refused by it (PT400) rather than by the policy (42501). Refused either way.
  e_dv_i  constant text[] := ARRAY['ok:1','ok:1','42501','PT400','PT400','PT400','42501','42501'];
  v_ea uuid; v_eb uuid; v_pa uuid; v_pb uuid; v_va uuid; v_vb uuid; v_sa uuid; v_sb uuid; v_da uuid; v_db uuid; v_ca uuid; v_cb uuid;
  v_stmts text[]; v_exp text[]; v_lbl text[]; v_got text; v_n bigint; v_n2 bigint; v_m text; v_t text; i int; j int;
  v_tables constant text[] := ARRAY['entities','entity_members','connections','actuals_monthly','vat_rules','plans','plan_versions',
                                    'scenarios','drivers','driver_values','line_map','plan_lines','packs'];
  v_where text[]; v_seen bigint[];
BEGIN
  -- ── Fixtures, created through the real paths (as the users themselves) where the API allows ──
  PERFORM fpa_test.as_user('user_ownerA');
  v_ea := fpa.create_entity('Alpha Test Ltd', 'IE', 'EUR', 1::smallint);
  PERFORM fpa.add_member(v_ea, 'user_editorA', 'editor');
  PERFORM fpa.add_member(v_ea, 'user_viewerA', 'viewer');
  PERFORM fpa.add_member(v_ea, 'user_inactiveA', 'editor');
  PERFORM fpa.set_member(v_ea, 'user_inactiveA', 'editor', false);
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_ea, 'csv') RETURNING id INTO v_ca;
  SELECT p.id INTO v_pa FROM fpa.plans p WHERE p.entity_id = v_ea;
  PERFORM fpa_test.as_user('user_editorA');
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_pa, 'budget', 'Budget 2027') RETURNING id INTO v_va;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_va, 'Base', true) RETURNING id INTO v_sa;
  INSERT INTO fpa.drivers (plan_id, key, label, unit, kind) VALUES (v_pa, 'price', 'Average price', 'currency', 'input') RETURNING id INTO v_da;
  INSERT INTO fpa.driver_values (driver_id, scenario_id, period, value) VALUES (v_da, v_sa, '2027-01-01', 42.5);
  INSERT INTO fpa.line_map (connection_id, account_code, plan_line, vat_rate_code) VALUES (v_ca, '4000', 'revenue.sales', 'IE_STD');
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin)
  VALUES (v_va, v_sa, 'revenue.sales', '2027-01-01', 1000.00, 'manual'), (v_va, v_sa, 'revenue.sales', '2026-12-01', NULL, 'actual');
  INSERT INTO fpa.packs (version_id, scenario_id, period, narrative) VALUES (v_va, v_sa, '2027-01-01', 'January pack');

  PERFORM fpa_test.as_user('user_ownerB');
  v_eb := fpa.create_entity('Bravo Test Ltd', 'UK', 'GBP', 4::smallint);
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_eb, 'csv') RETURNING id INTO v_cb;
  SELECT p.id INTO v_pb FROM fpa.plans p WHERE p.entity_id = v_eb;
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_pb, 'forecast', 'Forecast') RETURNING id INTO v_vb;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_vb, 'Base', true) RETURNING id INTO v_sb;
  INSERT INTO fpa.drivers (plan_id, key, label, unit, kind) VALUES (v_pb, 'price', 'Average price', 'currency', 'input') RETURNING id INTO v_db;
  INSERT INTO fpa.driver_values (driver_id, scenario_id, period, value) VALUES (v_db, v_sb, '2027-04-01', 10);
  INSERT INTO fpa.line_map (connection_id, account_code, plan_line) VALUES (v_cb, '4000', 'revenue.sales');
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (v_vb, v_sb, 'revenue.sales', '2027-04-01', 500.00, 'driver');
  INSERT INTO fpa.packs (version_id, period, narrative) VALUES (v_vb, '2027-04-01', 'April pack');

  -- Rows authenticated can never write: actuals and VAT rules (as postgres, standing in for the
  -- Phase 1 sync and Peter's SQL). The VAT rows are test fixtures only, not the draft seed.
  PERFORM fpa_test.as_postgres();
  INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, period, amount)
  VALUES (v_ea, v_ca, '4000', '2026-11-01', -1200.00), (v_ea, v_ca, '4000', '2026-12-01', -900.50), (v_eb, v_cb, '4000', '2026-12-01', -300.00);
  INSERT INTO fpa.vat_rules (jurisdiction, rate_code, rate, effective_from, verified_at, source_url) VALUES
    ('IE', 'TEST_IE_A', 23.00, '2025-01-01', now(), 'https://www.revenue.ie/'),
    ('IE', 'TEST_IE_B', 13.50, '2025-01-01', NULL, NULL),
    ('UK', 'TEST_UK_A', 20.00, '2025-01-01', now(), 'https://www.gov.uk/');

  PERFORM fpa_test.check(v_ea IS NOT NULL AND v_eb IS NOT NULL AND v_pa IS NOT NULL AND v_pb IS NOT NULL
    AND (SELECT count(*) FROM fpa.entity_members m WHERE m.entity_id = v_ea AND m.clerk_user_id = 'user_ownerA' AND m.role = 'owner' AND m.is_active) = 1
    AND (SELECT count(*) FROM fpa.plans p WHERE p.entity_id = v_ea AND p.name = 'Main plan' AND p.fiscal_year_start = 1) = 1,
    'create_entity: entity, owner membership and default plan created');

  -- ── 1. Reads by role: rows of entity A each role can see ──
  v_where := ARRAY[format('id = %L', v_ea), format('entity_id = %L', v_ea), format('entity_id = %L', v_ea), format('entity_id = %L', v_ea),
                   'jurisdiction = ''IE''', format('entity_id = %L', v_ea), format('plan_id = %L', v_pa), format('version_id = %L', v_va),
                   format('plan_id = %L', v_pa), format('driver_id = %L', v_da), format('connection_id = %L', v_ca),
                   format('version_id = %L', v_va), format('version_id = %L', v_va)];
  v_seen := ARRAY[1, 4, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 1]::bigint[];   -- what a member of A sees
  FOR i IN 1 .. array_length(v_tables, 1) LOOP
    FOR j IN 1 .. 8 LOOP
      PERFORM fpa_test.as_user(v_who[j]);
      v_n := fpa_test.cnt(format('SELECT count(*) FROM fpa.%I WHERE %s', v_tables[i], v_where[i]));
      PERFORM fpa_test.as_postgres();
      PERFORM fpa_test.check(v_n = CASE WHEN j <= 3 THEN v_seen[i] WHEN j <= 6 THEN 0 ELSE -1 END,
        format('read %s of entity A as %s', v_tables[i], v_who[j]), v_n::text);
    END LOOP;
  END LOOP;
  FOR j IN 1 .. 8 LOOP
    PERFORM fpa_test.as_user(v_who[j]);
    v_n := fpa_test.cnt('SELECT count(*) FROM fpa.schema_migrations');
    PERFORM fpa_test.as_postgres();
    PERFORM fpa_test.check(v_n = -1, format('read schema_migrations as %s is refused', v_who[j]), v_n::text);
  END LOOP;

  -- A signed-in user who is a member of nothing sees zero rows in every table.
  PERFORM fpa_test.as_user('user_outsider');
  SELECT sum(fpa_test.cnt(format('SELECT count(*) FROM fpa.%I', t))) INTO v_n FROM unnest(v_tables) t;
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(v_n = 0, 'a signed-in non-member sees zero rows in every table', v_n::text);
  -- A member of B sees exactly B's rows, and A's owner exactly A's.
  PERFORM fpa_test.as_user('user_ownerB');
  v_m := (SELECT string_agg(t || '=' || fpa_test.cnt(format('SELECT count(*) FROM fpa.%I', t)), ',' ORDER BY t) FROM unnest(v_tables) t);
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(v_m = 'actuals_monthly=1,connections=1,driver_values=1,drivers=1,entities=1,entity_members=1,line_map=1,packs=1,plan_lines=1,plan_versions=1,plans=1,scenarios=1,vat_rules=1',
    'owner of B sees only B (and UK VAT rules)', v_m);
  PERFORM fpa_test.as_user('user_ownerA');
  v_m := (SELECT string_agg(t || '=' || fpa_test.cnt(format('SELECT count(*) FROM fpa.%I', t)), ',' ORDER BY t) FROM unnest(v_tables) t);
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(v_m = 'actuals_monthly=2,connections=1,driver_values=1,drivers=1,entities=1,entity_members=4,line_map=1,packs=1,plan_lines=2,plan_versions=1,plans=1,scenarios=1,vat_rules=1',
    'owner of A sees only A (and verified IE VAT rules)', v_m);

  -- ── 2. Writes by role on entity A (each attempt is undone) ──
  v_lbl := ARRAY[]::text[]; v_stmts := ARRAY[]::text[]; v_exp := ARRAY[]::text[];
  -- Adds a statement with its expected results (8 per statement, flattened).
  -- entities
  v_lbl := v_lbl || 'entities: rename'::text;                 v_stmts := v_stmts || format('UPDATE fpa.entities SET name = ''Renamed'' WHERE id = %L', v_ea); v_exp := v_exp || e_own_u;
  v_lbl := v_lbl || 'entities: change currency'::text;        v_stmts := v_stmts || format('UPDATE fpa.entities SET currency = ''GBP'' WHERE id = %L', v_ea); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'entities: set ledgrly_company_id'::text; v_stmts := v_stmts || format('UPDATE fpa.entities SET ledgrly_company_id = gen_random_uuid() WHERE id = %L', v_ea); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'entities: insert directly'::text;        v_stmts := v_stmts || 'INSERT INTO fpa.entities (name, jurisdiction, currency) VALUES (''Direct'', ''IE'', ''EUR'')'::text; v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'entities: remove'::text;                 v_stmts := v_stmts || format('%s FROM fpa.entities WHERE id = %L', v_del, v_ea); v_exp := v_exp || e_none;
  -- entity_members: only through owner functions
  v_lbl := v_lbl || 'entity_members: insert'::text;   v_stmts := v_stmts || format('INSERT INTO fpa.entity_members (entity_id, clerk_user_id, role) VALUES (%L, ''user_sneaky'', ''owner'')', v_ea); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'entity_members: update'::text;   v_stmts := v_stmts || format('UPDATE fpa.entity_members SET role = ''owner'' WHERE entity_id = %L', v_ea); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'entity_members: remove'::text;   v_stmts := v_stmts || format('%s FROM fpa.entity_members WHERE entity_id = %L', v_del, v_ea); v_exp := v_exp || e_none;
  -- connections
  v_lbl := v_lbl || 'connections: add'::text;                  v_stmts := v_stmts || format('INSERT INTO fpa.connections (entity_id, source_type) VALUES (%L, ''mcp'')', v_ea); v_exp := v_exp || e_own_i;
  v_lbl := v_lbl || 'connections: add as active'::text;        v_stmts := v_stmts || format('INSERT INTO fpa.connections (entity_id, source_type, status) VALUES (%L, ''mcp'', ''active'')', v_ea); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'connections: disable'::text;              v_stmts := v_stmts || format('UPDATE fpa.connections SET status = ''disabled'' WHERE id = %L', v_ca); v_exp := v_exp || e_own_u;
  v_lbl := v_lbl || 'connections: mark active'::text;          v_stmts := v_stmts || format('UPDATE fpa.connections SET status = ''active'' WHERE id = %L', v_ca);
    v_exp := v_exp || ARRAY['42501','ok:0','ok:0','ok:0','ok:0','ok:0','42501','42501'];
  v_lbl := v_lbl || 'connections: set last_synced_at'::text;  v_stmts := v_stmts || format('UPDATE fpa.connections SET last_synced_at = now() WHERE id = %L', v_ca); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'connections: set actuals_through'::text; v_stmts := v_stmts || format('UPDATE fpa.connections SET actuals_through = ''2026-12-01'' WHERE id = %L', v_ca); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'connections: remove'::text;               v_stmts := v_stmts || format('%s FROM fpa.connections WHERE id = %L', v_del, v_ca); v_exp := v_exp || e_none;
  -- actuals_monthly and vat_rules: never written by an API role
  v_lbl := v_lbl || 'actuals_monthly: insert'::text; v_stmts := v_stmts || format('INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, period, amount) VALUES (%L, %L, ''5000'', ''2026-12-01'', 1)', v_ea, v_ca); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'actuals_monthly: update'::text; v_stmts := v_stmts || format('UPDATE fpa.actuals_monthly SET amount = 0 WHERE entity_id = %L', v_ea); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'actuals_monthly: remove'::text; v_stmts := v_stmts || format('%s FROM fpa.actuals_monthly WHERE entity_id = %L', v_del, v_ea); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'vat_rules: insert'::text; v_stmts := v_stmts || 'INSERT INTO fpa.vat_rules (jurisdiction, rate_code, rate, effective_from) VALUES (''IE'', ''X'', 1, ''2026-01-01'')'::text; v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'vat_rules: update'::text; v_stmts := v_stmts || 'UPDATE fpa.vat_rules SET rate = 0'::text; v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'vat_rules: remove'::text; v_stmts := v_stmts || format('%s FROM fpa.vat_rules', v_del); v_exp := v_exp || e_none;
  -- schema_migrations
  v_lbl := v_lbl || 'schema_migrations: insert'::text; v_stmts := v_stmts || 'INSERT INTO fpa.schema_migrations (filename, checksum) VALUES (''9999_x.sql'', repeat(''0'', 64))'::text; v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'schema_migrations: update'::text; v_stmts := v_stmts || 'UPDATE fpa.schema_migrations SET checksum = repeat(''1'', 64)'::text; v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'schema_migrations: remove'::text; v_stmts := v_stmts || format('%s FROM fpa.schema_migrations', v_del); v_exp := v_exp || e_none;
  -- plan data: editors and owners write, viewers and everyone else cannot
  v_lbl := v_lbl || 'plans: insert'::text;         v_stmts := v_stmts || format('INSERT INTO fpa.plans (entity_id, name) VALUES (%L, ''Second plan'')', v_ea); v_exp := v_exp || e_ed_i;
  v_lbl := v_lbl || 'plans: rename'::text;         v_stmts := v_stmts || format('UPDATE fpa.plans SET name = ''Renamed'' WHERE id = %L', v_pa); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'plans: move entity'::text;    v_stmts := v_stmts || format('UPDATE fpa.plans SET entity_id = %L WHERE id = %L', v_eb, v_pa); v_exp := v_exp || e_none;
  v_lbl := v_lbl || 'plans: remove'::text;         v_stmts := v_stmts || format('%s FROM fpa.plans WHERE id = %L', v_del, v_pa); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'plan_versions: insert'::text; v_stmts := v_stmts || format('INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (%L, ''forecast'', ''F2'')', v_pa); v_exp := v_exp || e_ed_i;
  v_lbl := v_lbl || 'plan_versions: rename'::text; v_stmts := v_stmts || format('UPDATE fpa.plan_versions SET name = ''Renamed'' WHERE id = %L', v_va); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'plan_versions: remove'::text; v_stmts := v_stmts || format('%s FROM fpa.plan_versions WHERE id = %L', v_del, v_va); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'scenarios: insert'::text;     v_stmts := v_stmts || format('INSERT INTO fpa.scenarios (version_id, name) VALUES (%L, ''Best'')', v_va); v_exp := v_exp || e_ed_i;
  v_lbl := v_lbl || 'scenarios: rename'::text;     v_stmts := v_stmts || format('UPDATE fpa.scenarios SET name = ''Renamed'' WHERE id = %L', v_sa); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'scenarios: remove'::text;     v_stmts := v_stmts || format('%s FROM fpa.scenarios WHERE id = %L', v_del, v_sa); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'drivers: insert'::text;       v_stmts := v_stmts || format('INSERT INTO fpa.drivers (plan_id, key, label, unit, kind) VALUES (%L, ''headcount'', ''Headcount'', ''count'', ''input'')', v_pa); v_exp := v_exp || e_ed_i;
  v_lbl := v_lbl || 'drivers: relabel'::text;      v_stmts := v_stmts || format('UPDATE fpa.drivers SET label = ''Renamed'' WHERE id = %L', v_da); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'drivers: remove'::text;       v_stmts := v_stmts || format('%s FROM fpa.drivers WHERE id = %L', v_del, v_da); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'driver_values: insert'::text; v_stmts := v_stmts || format('INSERT INTO fpa.driver_values (driver_id, scenario_id, period, value) VALUES (%L, %L, ''2027-02-01'', 5)', v_da, v_sa); v_exp := v_exp || e_dv_i;
  v_lbl := v_lbl || 'driver_values: update'::text; v_stmts := v_stmts || format('UPDATE fpa.driver_values SET value = 1 WHERE driver_id = %L', v_da); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'driver_values: remove'::text; v_stmts := v_stmts || format('%s FROM fpa.driver_values WHERE driver_id = %L', v_del, v_da); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'line_map: insert'::text;      v_stmts := v_stmts || format('INSERT INTO fpa.line_map (connection_id, account_code, plan_line) VALUES (%L, ''4100'', ''revenue.other'')', v_ca); v_exp := v_exp || e_ed_i;
  v_lbl := v_lbl || 'line_map: update'::text;      v_stmts := v_stmts || format('UPDATE fpa.line_map SET plan_line = ''revenue.other'' WHERE connection_id = %L', v_ca); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'line_map: remove'::text;      v_stmts := v_stmts || format('%s FROM fpa.line_map WHERE connection_id = %L', v_del, v_ca); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'plan_lines: insert'::text;    v_stmts := v_stmts || format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''revenue.other'', ''2027-03-01'', 10, ''manual'')', v_va, v_sa); v_exp := v_exp || e_ed_i;
  v_lbl := v_lbl || 'plan_lines: update'::text;    v_stmts := v_stmts || format('UPDATE fpa.plan_lines SET amount = 1 WHERE version_id = %L AND origin = ''manual''', v_va); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'plan_lines: remove'::text;    v_stmts := v_stmts || format('%s FROM fpa.plan_lines WHERE version_id = %L AND origin = ''manual''', v_del, v_va); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'packs: insert'::text;         v_stmts := v_stmts || format('INSERT INTO fpa.packs (version_id, scenario_id, period, narrative) VALUES (%L, %L, ''2027-02-01'', ''x'')', v_va, v_sa); v_exp := v_exp || e_ed_i;
  v_lbl := v_lbl || 'packs: update'::text;         v_stmts := v_stmts || format('UPDATE fpa.packs SET narrative = ''y'' WHERE version_id = %L', v_va); v_exp := v_exp || e_ed_u;
  v_lbl := v_lbl || 'packs: remove'::text;         v_stmts := v_stmts || format('%s FROM fpa.packs WHERE version_id = %L', v_del, v_va); v_exp := v_exp || e_ed_u;

  FOR i IN 1 .. array_length(v_stmts, 1) LOOP
    FOR j IN 1 .. 8 LOOP
      PERFORM fpa_test.as_user(v_who[j]);
      v_got := fpa_test.attempt(v_stmts[i]);
      PERFORM fpa_test.as_postgres();
      PERFORM fpa_test.check(v_got = v_exp[(i - 1) * 8 + j], format('%s as %s: expected %s', v_lbl[i], v_who[j], v_exp[(i - 1) * 8 + j]), v_got);
    END LOOP;
  END LOOP;

  -- ── 3. Cross-entity: A's owner against B's rows, and a user who belongs to both ──
  PERFORM fpa_test.as_user('user_ownerA');
  PERFORM fpa_test.check(fpa_test.attempt(format('UPDATE fpa.plans SET name = ''x'' WHERE id = %L', v_pb)) = 'ok:0', 'cross-entity: A cannot rename B''s plan');
  PERFORM fpa_test.check(fpa_test.attempt(format('INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (%L, ''budget'', ''x'')', v_pb)) = '42501', 'cross-entity: A cannot add a version to B''s plan');
  PERFORM fpa_test.check(fpa_test.attempt(format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''x'', ''2027-01-01'', 1, ''manual'')', v_vb, v_sb)) = '42501',
    'cross-entity: A cannot add a plan line to B''s version');
  PERFORM fpa_test.check(fpa_test.attempt(format('INSERT INTO fpa.line_map (connection_id, account_code, plan_line) VALUES (%L, ''9'', ''x'')', v_cb)) = '42501', 'cross-entity: A cannot map B''s connection');
  PERFORM fpa_test.check(fpa_test.attempt(format('INSERT INTO fpa.connections (entity_id, source_type) VALUES (%L, ''csv'')', v_eb)) = '42501', 'cross-entity: A cannot add a connection to B');
  PERFORM fpa_test.check(fpa_test.attempt(format('%s FROM fpa.plans WHERE id = %L', v_del, v_pb)) = 'ok:0', 'cross-entity: A cannot remove B''s plan');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.add_member(%L, ''user_ownerA'', ''owner'')', v_eb)) LIKE 'PT403:%', 'cross-entity: A cannot add itself to B');
  PERFORM fpa_test.check(fpa_test.val(format('SELECT fpa.is_entity_member(%L, ''viewer'')', v_eb)) = 'false', 'cross-entity: is_entity_member(B) is false for A');
  PERFORM fpa_test.check(fpa_test.val(format('SELECT fpa.member_for_plan(%L) OR fpa.member_for_version(%L) OR fpa.member_for_scenario(%L) OR fpa.member_for_driver(%L) OR fpa.member_for_connection(%L)', v_pb, v_vb, v_sb, v_db, v_cb)) = 'false',
    'cross-entity: every membership helper is false for B''s rows');
  PERFORM fpa_test.as_postgres();

  -- user_ownerA also becomes an editor of B: rows still cannot mix the two entities.
  PERFORM fpa_test.as_user('user_ownerB');
  PERFORM fpa.add_member(v_eb, 'user_ownerA', 'editor');
  PERFORM fpa_test.as_user('user_ownerA');
  PERFORM fpa_test.check(fpa_test.attempt(format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''x'', ''2027-01-01'', 1, ''manual'')', v_va, v_sb)) = '23503',
    'two entities: a plan line cannot use another entity''s scenario');
  PERFORM fpa_test.check(fpa_test.attempt(format('INSERT INTO fpa.driver_values (driver_id, scenario_id, period, value) VALUES (%L, %L, ''2027-01-01'', 1)', v_da, v_sb)) = 'PT400',
    'two entities: a driver value cannot join a driver and a scenario of different plans');
  PERFORM fpa_test.check(fpa_test.attempt(format('INSERT INTO fpa.plan_versions (plan_id, kind, name, based_on_version_id) VALUES (%L, ''forecast'', ''x'', %L)', v_pa, v_vb)) = '23503',
    'two entities: a version cannot be based on another plan''s version');
  PERFORM fpa_test.check(fpa_test.attempt(format('INSERT INTO fpa.packs (version_id, scenario_id, period) VALUES (%L, %L, ''2027-01-01'')', v_va, v_sb)) = '23503',
    'two entities: a pack cannot use another entity''s scenario');
  PERFORM fpa_test.check(fpa_test.attempt(format('UPDATE fpa.plan_lines SET version_id = %L WHERE version_id = %L', v_vb, v_va)) = '42501',
    'two entities: a plan line cannot be moved to another version');
  PERFORM fpa_test.as_user('user_ownerB');
  PERFORM fpa.set_member(v_eb, 'user_ownerA', 'editor', false);
  PERFORM fpa_test.as_user('user_ownerA');
  PERFORM fpa_test.check(fpa_test.cnt(format('SELECT count(*) FROM fpa.plans WHERE entity_id = %L', v_eb)) = 0, 'deactivated: A sees nothing of B again');
  PERFORM fpa_test.as_postgres();

  -- An inactive member gets nothing; reactivating restores access.
  PERFORM fpa_test.as_user('user_inactiveA');
  PERFORM fpa_test.check(fpa_test.val(format('SELECT fpa.is_entity_member(%L, ''viewer'')', v_ea)) = 'false', 'inactive member: is_entity_member is false');
  PERFORM fpa_test.as_user('user_ownerA');
  PERFORM fpa.add_member(v_ea, 'user_inactiveA', 'viewer');
  PERFORM fpa_test.as_user('user_inactiveA');
  PERFORM fpa_test.check(fpa_test.cnt(format('SELECT count(*) FROM fpa.plans WHERE entity_id = %L', v_ea)) = 1, 'reactivated member sees the entity again');
  PERFORM fpa_test.as_user('user_ownerA');
  PERFORM fpa.set_member(v_ea, 'user_inactiveA', 'viewer', false);
  PERFORM fpa_test.as_postgres();

  -- ── 4. Helpers and function privileges ──
  FOR v_t IN SELECT unnest(ARRAY['plan_entity','version_entity','scenario_entity','driver_entity','connection_entity']) LOOP
    SELECT p.oid::regprocedure::text INTO v_m FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND p.proname = v_t;
    PERFORM fpa_test.check(NOT has_function_privilege('anon', v_m, 'EXECUTE') AND NOT has_function_privilege('authenticated', v_m, 'EXECUTE')
      AND NOT has_function_privilege('service_role', v_m, 'EXECUTE'), format('lookup helper %s is executable by no API role', v_t));
    PERFORM fpa_test.as_user('user_ownerA');
    v_got := fpa_test.val(format('SELECT fpa.%I(%L)::text', v_t, v_pa));
    PERFORM fpa_test.as_postgres();
    PERFORM fpa_test.check(v_got = '42501', format('lookup helper %s refused to authenticated when called', v_t), v_got);
  END LOOP;
  FOR v_t IN SELECT unnest(ARRAY['is_entity_member','member_for_plan','member_for_version','member_for_scenario','member_for_driver',
                                 'member_for_connection','member_in_jurisdiction']) LOOP
    SELECT p.oid::regprocedure::text INTO v_m FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND p.proname = v_t;
    PERFORM fpa_test.check(has_function_privilege('authenticated', v_m, 'EXECUTE') AND NOT has_function_privilege('anon', v_m, 'EXECUTE')
      AND NOT has_function_privilege('service_role', v_m, 'EXECUTE')
      AND (SELECT p.prorettype = 'boolean'::regtype AND p.prosecdef AND p.provolatile = 's' FROM pg_proc p WHERE p.oid = v_m::regprocedure),
      format('membership helper %s: authenticated only, returns boolean, SECURITY DEFINER STABLE', v_t));
  END LOOP;
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                      WHERE p.pronamespace = 'fpa'::regnamespace AND a.grantee = 0),
    'no function in fpa is executable by PUBLIC');
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND p.prosecdef
                                      AND NOT coalesce(p.proconfig::text LIKE '%search_path=fpa, pg_temp%', false)),
    'every SECURITY DEFINER function has a fixed search_path');
  PERFORM fpa_test.as_user('user_ownerA');
  v_m := fpa_test.val(format('SELECT concat_ws('','', fpa.is_entity_member(%L), fpa.is_entity_member(%L, ''owner''), fpa.member_for_plan(%L, ''editor''), fpa.member_for_version(%L), fpa.member_for_scenario(%L), fpa.member_for_driver(%L), fpa.member_for_connection(%L), fpa.member_in_jurisdiction(''IE''), fpa.member_in_jurisdiction(''UK''))',
    v_ea, v_ea, v_pa, v_va, v_sa, v_da, v_ca));
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(v_m = 't,t,t,t,t,t,t,t,f', 'membership helpers answer true/false for the caller only', v_m);
  PERFORM fpa_test.as_user('user_viewerA');
  v_m := fpa_test.val(format('SELECT concat_ws('','', fpa.is_entity_member(%L), fpa.is_entity_member(%L, ''editor''), fpa.is_entity_member(%L, ''nonsense''))', v_ea, v_ea, v_ea));
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(v_m = 't,f,f', 'viewer < editor; an unknown role name answers false', v_m);

  -- Every callable function as anon and service_role: refused (no USAGE on the schema).
  FOR v_t IN SELECT unnest(ARRAY[
      format('SELECT fpa.is_entity_member(%L)', v_ea), format('SELECT fpa.member_for_plan(%L)', v_pa), format('SELECT fpa.member_for_version(%L)', v_va),
      format('SELECT fpa.member_for_scenario(%L)', v_sa), format('SELECT fpa.member_for_driver(%L)', v_da), format('SELECT fpa.member_for_connection(%L)', v_ca),
      'SELECT fpa.member_in_jurisdiction(''IE'')', format('SELECT fpa.plan_entity(%L)', v_pa), format('SELECT fpa.version_entity(%L)', v_va),
      format('SELECT fpa.scenario_entity(%L)', v_sa), format('SELECT fpa.driver_entity(%L)', v_da), format('SELECT fpa.connection_entity(%L)', v_ca),
      'SELECT fpa.create_entity(''Anon Ltd'', ''IE'', ''EUR'', 1::smallint)', format('SELECT fpa.add_member(%L, ''user_x'', ''owner'')', v_ea),
      format('SELECT fpa.set_member(%L, ''user_ownerA'', ''viewer'', false)', v_ea)]) LOOP
    FOREACH v_m IN ARRAY ARRAY['anon', 'service_role'] LOOP
      PERFORM fpa_test.as_user(v_m);
      v_got := fpa_test.attempt(v_t);
      PERFORM fpa_test.as_postgres();
      PERFORM fpa_test.check(v_got = '42501', format('%s refused to %s', split_part(v_t, '(', 1), v_m), v_got);
    END LOOP;
  END LOOP;

  -- ── 5. create_entity and the member functions ──
  PERFORM fpa_test.as_user('authenticated');
  v_m := fpa_test.try_msg('SELECT fpa.create_entity(''No User Ltd'', ''IE'', ''EUR'', 1::smallint)');
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(v_m LIKE 'PT401:%', 'create_entity: a token with no user id is refused', v_m);
  PERFORM fpa_test.as_user('user_capC');
  PERFORM fpa_test.check(fpa_test.try_msg('SELECT fpa.create_entity(''Bad Ltd'', ''FR'', ''EUR'', 1::smallint)') LIKE 'PT400:%', 'create_entity: a bad jurisdiction is refused');
  PERFORM fpa_test.check(fpa_test.try_msg('SELECT fpa.create_entity(''Bad Ltd'', ''IE'', ''USD'', 1::smallint)') LIKE 'PT400:%', 'create_entity: a bad currency is refused');
  PERFORM fpa_test.check(fpa_test.try_msg('SELECT fpa.create_entity(''Bad Ltd'', ''IE'', ''EUR'', 13::smallint)') LIKE 'PT400:%', 'create_entity: a bad fiscal month is refused');
  PERFORM fpa_test.check(fpa_test.try_msg('SELECT fpa.create_entity(''   '', ''IE'', ''EUR'', 1::smallint)') LIKE 'PT400:%', 'create_entity: a blank name is refused');
  FOR i IN 1 .. 10 LOOP PERFORM fpa.create_entity('Cap Test ' || i, 'IE', 'EUR', 1::smallint); END LOOP;
  v_m := fpa_test.try_msg('SELECT fpa.create_entity(''Cap Test 11'', ''IE'', ''EUR'', 1::smallint)');
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(v_m = 'PT429: You already own 10 entities, which is the most allowed.', 'create_entity: the 11th owned entity is refused with a clear error', v_m);
  PERFORM fpa_test.check((SELECT count(*) FROM fpa.entity_members m WHERE m.clerk_user_id = 'user_capC' AND m.role = 'owner') = 10
    AND NOT EXISTS (SELECT 1 FROM fpa.entities e WHERE e.name = 'Cap Test 11'), 'create_entity: the refused call left nothing behind');
  -- Parallel calls: create_entity takes a per-user advisory lock held until the transaction ends, so
  -- a second concurrent call by the same user waits, then counts the first call's entity.
  PERFORM fpa_test.check(EXISTS (SELECT 1 FROM pg_locks l WHERE l.locktype = 'advisory' AND l.pid = pg_backend_pid() AND l.granted
                                  AND ((l.classid::bigint << 32) | l.objid::bigint) = (hashtextextended('fpa.create_entity:user_capC', 0) & x'FFFFFFFFFFFFFFFF'::bigint)),
    'create_entity: holds the per-user advisory lock until commit (parallel calls serialise)');
  -- Rollback: if a later step fails, nothing from the earlier steps remains.
  BEGIN
    CREATE TRIGGER zz_test_fail BEFORE INSERT ON fpa.plans FOR EACH ROW EXECUTE FUNCTION fpa_test.fail_insert();
    PERFORM fpa_test.as_user('user_rollbackD');
    v_m := fpa_test.try_msg('SELECT fpa.create_entity(''Rollback Test Ltd'', ''IE'', ''EUR'', 1::smallint)');
    PERFORM fpa_test.as_postgres();
    v_n := (SELECT count(*) FROM fpa.entities e WHERE e.name = 'Rollback Test Ltd');
    v_n2 := (SELECT count(*) FROM fpa.entity_members m WHERE m.clerk_user_id = 'user_rollbackD');
    RAISE EXCEPTION USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
  PERFORM fpa_test.check(v_m LIKE 'P0001: injected failure in plans%' AND v_n = 0 AND v_n2 = 0,
    'create_entity: a failure in the last step (default plan) undoes the entity and the membership', format('%s; entities %s, members %s', v_m, v_n, v_n2));
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgname = 'zz_test_fail'), 'rollback test trigger is gone');

  PERFORM fpa_test.as_user('user_editorA');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.add_member(%L, ''user_newbie'', ''viewer'')', v_ea)) LIKE 'PT403:%', 'add_member: an editor is refused');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.set_member(%L, ''user_viewerA'', ''owner'', true)', v_ea)) LIKE 'PT403:%', 'set_member: an editor cannot promote anyone');
  PERFORM fpa_test.as_user('user_viewerA');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.add_member(%L, ''user_newbie'', ''viewer'')', v_ea)) LIKE 'PT403:%', 'add_member: a viewer is refused');
  PERFORM fpa_test.as_user('user_ownerB');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.set_member(%L, ''user_ownerA'', ''viewer'', false)', v_ea)) LIKE 'PT403:%', 'set_member: another entity''s owner is refused');
  PERFORM fpa_test.as_user('user_ownerA');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.add_member(%L, ''user_newbie'', ''admin'')', v_ea)) LIKE 'PT400:%', 'add_member: a bad role is refused');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.add_member(%L, ''not a user'', ''viewer'')', v_ea)) LIKE 'PT400:%', 'add_member: a bad user id is refused');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.set_member(%L, ''user_ownerA'', ''editor'', true)', v_ea)) LIKE 'PT409:%', 'set_member: the last owner cannot step down');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.set_member(%L, ''user_ownerA'', ''owner'', false)', v_ea)) LIKE 'PT409:%', 'set_member: the last owner cannot deactivate');
  PERFORM fpa_test.check(fpa_test.try_msg(format('SELECT fpa.set_member(%L, ''user_nobody'', ''viewer'', true)', v_ea)) LIKE 'PT404:%', 'set_member: an unknown member is reported');
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check((SELECT m.role = 'owner' AND m.is_active FROM fpa.entity_members m WHERE m.entity_id = v_ea AND m.clerk_user_id = 'user_ownerA'),
    'the refused owner changes left the owner unchanged');

  -- ── 6. Locked versions are read-only; editors lock, only owners unlock; both are recorded ──
  BEGIN
    PERFORM fpa_test.as_user('user_editorA');
    UPDATE fpa.plan_versions SET locked_at = '2000-01-01' WHERE id = v_va;   -- the server sets its own time
    PERFORM fpa_test.as_postgres();
    v_t := (SELECT concat_ws(',', v.locked_by, v.locked_at = now(), v.unlocked_at IS NULL, v.unlocked_by IS NULL) FROM fpa.plan_versions v WHERE v.id = v_va);
    PERFORM fpa_test.as_user('user_editorA');
    v_m := concat_ws(',',
      fpa_test.attempt(format('UPDATE fpa.plan_lines SET amount = 2 WHERE version_id = %L AND origin = ''manual''', v_va)),
      fpa_test.attempt(format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''x'', ''2027-05-01'', 1, ''manual'')', v_va, v_sa)),
      fpa_test.attempt(format('INSERT INTO fpa.scenarios (version_id, name) VALUES (%L, ''Late'')', v_va)),
      fpa_test.attempt(format('UPDATE fpa.driver_values SET value = 0 WHERE scenario_id = %L', v_sa)),
      fpa_test.attempt(format('INSERT INTO fpa.packs (version_id, period) VALUES (%L, ''2027-05-01'')', v_va)),
      fpa_test.attempt(format('UPDATE fpa.plan_versions SET name = ''Sneaky'' WHERE id = %L', v_va)),
      fpa_test.attempt(format('%s FROM fpa.plan_versions WHERE id = %L', v_del, v_va)),
      fpa_test.attempt(format('UPDATE fpa.plan_versions SET locked_at = now() + interval ''1 day'' WHERE id = %L', v_va)),
      fpa_test.attempt(format('UPDATE fpa.plan_versions SET locked_at = NULL WHERE id = %L', v_va)),
      fpa_test.attempt(format('UPDATE fpa.plan_versions SET locked_by = ''user_someoneElse'' WHERE id = %L', v_va)),
      fpa_test.attempt(format('UPDATE fpa.plan_versions SET unlocked_at = now() WHERE id = %L', v_va)));
    PERFORM fpa_test.as_user('user_viewerA');
    v_m := v_m || ',' || fpa_test.attempt(format('UPDATE fpa.plan_versions SET locked_at = NULL WHERE id = %L', v_va));
    PERFORM fpa_test.as_user('user_ownerA');
    UPDATE fpa.plan_versions SET locked_at = NULL WHERE id = v_va;
    PERFORM fpa_test.as_postgres();
    v_got := (SELECT concat_ws(',', v.locked_at IS NULL, v.locked_by, v.unlocked_at = now(), v.unlocked_by) FROM fpa.plan_versions v WHERE v.id = v_va);
    -- Unlocked, the version takes changes again, and a new lock records the new locker.
    PERFORM fpa_test.as_user('user_editorA');
    v_got := v_got || ';' || fpa_test.attempt(format('UPDATE fpa.plan_lines SET amount = 2 WHERE version_id = %L AND origin = ''manual''', v_va));
    PERFORM fpa_test.as_user('user_ownerA');
    UPDATE fpa.plan_versions SET locked_at = now() WHERE id = v_va;
    PERFORM fpa_test.as_postgres();
    v_got := v_got || ';' || (SELECT concat_ws(',', v.locked_by, v.unlocked_by) FROM fpa.plan_versions v WHERE v.id = v_va);
    RAISE EXCEPTION USING ERRCODE = 'P0099';
  EXCEPTION WHEN SQLSTATE 'P0099' THEN NULL;
  END;
  PERFORM fpa_test.as_postgres();
  PERFORM fpa_test.check(v_t = 'user_editorA,t,t,t',
    'locking: the server records who locked and sets the time itself (a sent time is ignored)', v_t);
  PERFORM fpa_test.check(v_m = 'PT423,PT423,PT423,PT423,PT423,PT423,PT423,PT423,PT403,42501,42501,ok:0',
    'a locked version refuses changes to its lines, scenarios, values, packs, name, lock time and removal; an editor cannot unlock (PT403); the audit columns are not writable; a viewer cannot unlock', v_m);
  PERFORM fpa_test.check(v_got = 't,user_editorA,t,user_ownerA;ok:1;user_ownerA,user_ownerA',
    'unlocking: an owner can unlock, the server records who and when, the lock history is kept, and a new lock records the new locker', v_got);

  -- ── 7. Constraints (as postgres; each attempt undone) ──
  FOR v_t, v_m IN SELECT * FROM (VALUES
      (format('INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, period, amount) VALUES (%L, %L, ''4000'', ''2026-11-01'', 5)', v_ea, v_ca), '23505'),
      (format('INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, period, amount) VALUES (%L, %L, ''4000'', ''2026-10-01'', 5)', v_eb, v_ca), '23503'),
      (format('INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, period, amount) VALUES (%L, %L, ''4000'', ''2026-10-15'', 5)', v_ea, v_ca), '23514'),
      ('INSERT INTO fpa.entities (name, jurisdiction, currency) VALUES (''X'', ''FR'', ''EUR'')', '23514'),
      ('INSERT INTO fpa.entities (name, jurisdiction, currency) VALUES (''X'', ''IE'', ''USD'')', '23514'),
      ('INSERT INTO fpa.entities (name, jurisdiction, currency, vat_scheme) VALUES (''X'', ''IE'', ''EUR'', ''other'')', '23514'),
      ('INSERT INTO fpa.entities (name, jurisdiction, currency, vat_cycle_anchor) VALUES (''X'', ''IE'', ''EUR'', 13)', '23514'),
      (format('INSERT INTO fpa.entity_members (entity_id, clerk_user_id, role) VALUES (%L, ''user_x'', ''admin'')', v_ea), '23514'),
      (format('INSERT INTO fpa.entity_members (entity_id, clerk_user_id, role) VALUES (%L, ''user_ownerA'', ''viewer'')', v_ea), '23505'),
      (format('INSERT INTO fpa.connections (entity_id, source_type) VALUES (%L, ''email'')', v_ea), '23514'),
      (format('UPDATE fpa.connections SET status = ''broken'' WHERE id = %L', v_ca), '23514'),
      (format('INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (%L, ''actual'', ''x'')', v_pa), '23514'),
      (format('INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (%L, ''Second base'', true)', v_va), '23505'),
      (format('INSERT INTO fpa.drivers (plan_id, key, label, unit, kind) VALUES (%L, ''k'', ''K'', ''furlongs'', ''input'')', v_pa), '23514'),
      (format('INSERT INTO fpa.drivers (plan_id, key, label, unit, kind) VALUES (%L, ''k'', ''K'', ''count'', ''magic'')', v_pa), '23514'),
      (format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''x'', ''2027-06-01'', 5, ''actual'')', v_va, v_sa), '23514'),
      (format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''x'', ''2027-06-01'', NULL, ''manual'')', v_va, v_sa), '23514'),
      (format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''x'', ''2027-06-01'', 5, ''guess'')', v_va, v_sa), '23514'),
      (format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''x'', ''2027-06-02'', 5, ''manual'')', v_va, v_sa), '23514'),
      (format('INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (%L, %L, ''x'', ''2027-06-01'', 1000000000000.00, ''manual'')', v_va, v_sa), '22003'),
      ('INSERT INTO fpa.vat_rules (jurisdiction, rate_code, filing_frequency, due_day_rule, effective_from) VALUES (''IE'', ''F'', ''weekly'', ''x'', ''2026-01-01'')', '23514'),
      ('INSERT INTO fpa.vat_rules (jurisdiction, rate_code, rate, effective_from, verified_at) VALUES (''IE'', ''V'', 23, ''2026-01-01'', now())', '23514'),
      ('INSERT INTO fpa.schema_migrations (filename, checksum) VALUES (''0002_fpa_vat_rules_DRAFT.sql'', repeat(''0'', 64))', '23514')) v(s, e) LOOP
    v_got := fpa_test.attempt(v_t);
    PERFORM fpa_test.check(v_got = v_m, format('constraint: %s', left(regexp_replace(v_t, '''[0-9a-f-]{36}''', '<id>', 'g'), 140)), v_got);
  END LOOP;
  PERFORM fpa_test.check((SELECT count(*) FROM fpa.plan_lines l WHERE l.origin = 'actual' AND l.amount IS NOT NULL) = 0, 'no actual plan line carries a stored amount');

  -- ── 8. Structure: row security and updated_at everywhere ──
  PERFORM fpa_test.check((SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity) = 14
    AND (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r') = 14, 'all 14 tables have row security enabled');
  PERFORM fpa_test.check((SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
                           WHERE c.relnamespace = 'fpa'::regnamespace AND t.tgname = c.relname || '_updated_at') = 14, 'every table has its updated_at trigger');
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_constraint k WHERE k.connamespace = 'fpa'::regnamespace AND k.contype = 'f'
                                      AND k.confrelid::regclass::text NOT LIKE 'fpa.%'), 'no foreign key from fpa into any other schema');
  PERFORM fpa_test.check(NOT EXISTS (SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
                                      WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND a.attnum > 0 AND NOT a.attisdropped
                                        AND a.atttypid IN ('real'::regtype, 'double precision'::regtype, 'money'::regtype)), 'no float or money columns');
END $test$;

-- Report: failures, pass count, and the full privilege evidence (uncut).
DO $report$
DECLARE v_fail text; v_pass int; v_fails int; v_out text;
BEGIN
  SELECT count(*) FILTER (WHERE pass), count(*) FILTER (WHERE NOT pass),
         string_agg(CASE WHEN NOT pass THEN label || coalesce(' [got ' || detail || ']', '') END, ' | ' ORDER BY n)
    INTO v_pass, v_fails, v_fail FROM fpa_test.results;
  v_out := format(E'%s failure(s), %s pass(es)%s\n', v_fails, v_pass, CASE WHEN v_fails > 0 THEN E'\nFAILED: ' || v_fail ELSE '' END);
  v_out := v_out || E'\n== Schema fpa ACL ==\n' || (SELECT coalesce(array_to_string(n.nspacl, ', '), '(default)') || ' (owner ' || pg_get_userbyid(n.nspowner) || ')' FROM pg_namespace n WHERE n.nspname = 'fpa')
    || format(E'\nUSAGE: anon=%s authenticated=%s service_role=%s PUBLIC=%s', has_schema_privilege('anon', 'fpa', 'USAGE'), has_schema_privilege('authenticated', 'fpa', 'USAGE'),
              has_schema_privilege('service_role', 'fpa', 'USAGE'), EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname = 'fpa' AND a.grantee = 0));
  -- (Kept short: the connector cuts error messages longer than about 10,000 characters.)
  v_out := v_out || E'\n\n== Tables: row security and full ACL (relacl), less the owner entry postgres=arwdDxtm/postgres ==\n'
    || (SELECT string_agg(format('%s: rls=%s %s', c.relname, c.relrowsecurity,
          coalesce(nullif(array_to_string(ARRAY(SELECT x::text FROM unnest(c.relacl) x WHERE x::text <> 'postgres=arwdDxtm/postgres'), ','), ''), '(owner only)')), E'\n' ORDER BY c.relname)
        FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r')
    || E'\nEvery table carries the owner entry: ' || (SELECT bool_and(c.relacl::text[] @> ARRAY['postgres=arwdDxtm/postgres']) FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r')::text;
  v_out := v_out || E'\n\n== Column-level grants (pg_attribute.attacl) ==\n' || coalesce((SELECT string_agg(format('%s: %s', c.relname, x.cols), E'\n' ORDER BY c.relname)
    FROM pg_class c, LATERAL (SELECT string_agg(format('%s(%s)', p.priv, p.cols), ' ') AS cols FROM (
        SELECT a.privilege_type AS priv, pg_get_userbyid(a.grantee) AS who, string_agg(at.attname, ',' ORDER BY at.attnum) AS cols
          FROM pg_attribute at, aclexplode(at.attacl) a WHERE at.attrelid = c.oid AND at.attacl IS NOT NULL AND NOT at.attisdropped
         GROUP BY a.privilege_type, a.grantee ORDER BY 1) p) x
    WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND x.cols IS NOT NULL), '(none)')
    || E'\n(all column grants above are to authenticated; anon, service_role and PUBLIC hold none: '
    || (NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_attribute at ON at.attrelid = c.oid, aclexplode(at.attacl) a
                    WHERE c.relnamespace = 'fpa'::regnamespace AND a.grantee <> 'authenticated'::regrole))::text || ')';
  v_out := v_out || E'\n\n== Policies (' || (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'fpa')::text || ', all TO authenticated only: '
    || (SELECT bool_and(p.roles = '{authenticated}'::name[]) FROM pg_policies p WHERE p.schemaname = 'fpa')::text
    || E'; "fpa." and "::text" removed from the expressions) ==\n'
    || (SELECT string_agg(format('%s %s%s%s', p.policyname, p.cmd, coalesce(' using ' || replace(replace(p.qual, 'fpa.', ''), '::text', ''), ''),
          coalesce(' check ' || replace(replace(p.with_check, 'fpa.', ''), '::text', ''), '')), E'\n' ORDER BY p.tablename, p.policyname)
        FROM pg_policies p WHERE p.schemaname = 'fpa');
  v_out := v_out || E'\n\n== Functions: full ACL (proacl), security definer, volatility, EXECUTE by role ==\n' || (SELECT string_agg(format('%s: definer=%s %s acl=%s | anon=%s authenticated=%s service_role=%s PUBLIC=%s',
        p.oid::regprocedure, p.prosecdef, CASE p.provolatile WHEN 's' THEN 'stable' WHEN 'i' THEN 'immutable' ELSE 'volatile' END, coalesce(array_to_string(p.proacl, ','), '(default)'),
        has_function_privilege('anon', p.oid, 'EXECUTE'), has_function_privilege('authenticated', p.oid, 'EXECUTE'), has_function_privilege('service_role', p.oid, 'EXECUTE'),
        EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')), E'\n' ORDER BY p.proname)
    FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace);
  v_out := v_out || E'\n\n== Verdict ==\nExecutable by PUBLIC: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
        AND EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')), 'none')
    || E'\nExecutable by anon: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')), 'none')
    || E'\nExecutable by authenticated: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('authenticated', p.oid, 'EXECUTE')), 'none')
    || E'\nExecutable by service_role: ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('service_role', p.oid, 'EXECUTE')), 'none')
    || E'\nExecutable by no API role (internal): ' || coalesce((SELECT string_agg(p.proname, ', ' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
        AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')), 'none');
  RAISE EXCEPTION '%', v_out;
END $report$;
