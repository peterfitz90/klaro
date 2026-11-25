-- Timing of the 0004 functions at their limits, as the authenticated role with statement_timeout 8s
-- (the role's setting on this project). Runs after 0004 in one transaction (db/bundle.mjs builds
-- db/out/timing_0004.sql: BEGIN; 0004; this file). Realistic load: 50 other entities, each with 200
-- accounts x 24 months of actuals (all mapped) and of balances (240,000 rows of each), sit alongside the
-- test entity, and the timing user is also a viewer of 5 of them.
-- Setup is untimed. Each timed call is its own top-level statement, so the 8s timeout applies to each
-- call separately; every call runs 3 times and the report gives the worst. A cancelled call is recorded
-- as such and its changes undone, and the run goes on. The report raises, so everything rolls back.
-- Made-up data only.
CREATE SCHEMA fpa_test;
CREATE TABLE fpa_test.payload (k text PRIMARY KEY, v jsonb);
CREATE TABLE fpa_test.timing (n serial, label text, run int, ms numeric, detail text);
CREATE TABLE fpa_test.ids (k text PRIMARY KEY, id uuid);
GRANT USAGE ON SCHEMA fpa_test TO authenticated;
GRANT SELECT ON fpa_test.payload, fpa_test.ids TO authenticated;
GRANT INSERT ON fpa_test.timing TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA fpa_test TO authenticated;

-- 50 other entities with realistic volumes (as the table owner, untimed).
DO $others$
DECLARE v_e uuid; v_c uuid; i int;
BEGIN
  FOR i IN 1 .. 50 LOOP
    INSERT INTO fpa.entities (name, jurisdiction, currency) VALUES ('Other Test ' || i, 'IE', 'EUR') RETURNING id INTO v_e;
    INSERT INTO fpa.entity_members (entity_id, clerk_user_id, role) VALUES (v_e, 'user_otherOwner' || i, 'owner');
    IF i <= 5 THEN INSERT INTO fpa.entity_members (entity_id, clerk_user_id, role) VALUES (v_e, 'user_timingOwner', 'viewer'); END IF;
    INSERT INTO fpa.plans (entity_id, name) VALUES (v_e, 'Main plan');
    INSERT INTO fpa.connections (entity_id, source_type, status) VALUES (v_e, 'csv', 'active') RETURNING id INTO v_c;
    INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, period, amount)
    SELECT v_e, v_c, 'X' || lpad(a::text, 4, '0'), (DATE '2023-09-01' + make_interval(months => m))::date, ((a * 31 + m * 17 + i) % 8000 - 4000) + 0.25
      FROM generate_series(1, 200) a, generate_series(0, 23) m;
    INSERT INTO fpa.balances_monthly (entity_id, connection_id, account_code, period, closing_balance)
    SELECT v_e, v_c, 'B' || lpad(a::text, 4, '0'), (DATE '2023-09-01' + make_interval(months => m))::date, ((a * 29 + m * 13 + i) % 90000 - 20000) + 0.5
      FROM generate_series(1, 200) a, generate_series(0, 23) m;
    INSERT INTO fpa.line_map (connection_id, account_code, plan_line)
    SELECT v_c, 'X' || lpad(a::text, 4, '0'), (ARRAY['revenue','cost_of_sales','payroll','marketing','premises','other_operating','interest','tax','excluded'])[1 + a % 9]
      FROM generate_series(1, 200) a;
    INSERT INTO fpa.line_map (connection_id, account_code, plan_line)
    SELECT v_c, 'B' || lpad(a::text, 4, '0'), CASE WHEN a <= 5 THEN 'cash_bank' ELSE 'excluded' END FROM generate_series(1, 200) a;
  END LOOP;
END $others$;
ANALYZE fpa.actuals_monthly;
ANALYZE fpa.balances_monthly;
ANALYZE fpa.line_map;
ANALYZE fpa.entity_members;
ANALYZE fpa.connections;

-- The test entity, through the API path, as a made-up owner; a budget with 1,200 lines (untimed, as
-- the table owner) for the all-or-nothing save.
DO $fix$
DECLARE v_e uuid; v_c uuid; v_p uuid; v_v uuid; v_s uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"user_timingOwner","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_e := fpa.create_entity('Timing Test Ltd', 'IE', 'EUR', 1::smallint);
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_e, 'csv') RETURNING id INTO v_c;
  SELECT p.id INTO v_p FROM fpa.plans p WHERE p.entity_id = v_e;
  EXECUTE 'RESET ROLE';
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_p, 'budget', 'Timing budget') RETURNING id INTO v_v;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_v, 'Base', true) RETURNING id INTO v_s;
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin)
  SELECT v_v, v_s, l, (DATE '2020-01-01' + make_interval(months => m))::date, 100, 'from_actuals'
    FROM unnest(ARRAY['revenue','cost_of_sales','payroll','marketing','premises','other_operating','interest','tax']) l, generate_series(0, 149) m;
  INSERT INTO fpa_test.ids VALUES ('entity', v_e), ('connection', v_c), ('plan', v_p), ('version', v_v);
END $fix$;

-- Payloads (untimed). bal_big: exactly 20,000 rows, accounts B0001-B1000 x 20 months (2024-01 to
-- 2025-08), 160-character names, just under 5 MB. act: the same entity's P&L actuals for variance
-- (1,000 accounts x 20 months, loaded untimed). map: B0001-B0010 to Cash and bank, the rest excluded;
-- A0001-A1000 to P&L lines. save: all 1,200 budget lines with new amounts.
INSERT INTO fpa_test.payload
SELECT 'bal_big', jsonb_agg(jsonb_build_object('account_code', 'B' || lpad(a::text, 4, '0'), 'account_name', rpad('Balance account ' || a, 160, '.'),
                                               'month', to_char(DATE '2024-01-01' + make_interval(months => m), 'YYYY-MM-DD'),
                                               'amount', to_char(((a * 37 + m * 11) % 90000 - 20000) + 0.37, 'FM999999990.00')))
  FROM generate_series(1, 1000) a, generate_series(0, 19) m;
INSERT INTO fpa_test.payload
SELECT 'act', jsonb_agg(jsonb_build_object('account_code', 'A' || lpad(a::text, 4, '0'),
                                           'month', to_char(DATE '2024-01-01' + make_interval(months => m), 'YYYY-MM-DD'),
                                           'amount', to_char(((a * 13 + m * 7) % 5000 - 2500) + 0.11, 'FM999999990.00')))
  FROM generate_series(1, 1000) a, generate_series(0, 19) m;
INSERT INTO fpa_test.payload
SELECT 'map', jsonb_agg(x) FROM (
  SELECT jsonb_build_object('account_code', 'B' || lpad(a::text, 4, '0'), 'plan_line', CASE WHEN a <= 10 THEN 'cash_bank' ELSE 'excluded' END) x FROM generate_series(1, 1000) a
  UNION ALL
  SELECT jsonb_build_object('account_code', 'A' || lpad(a::text, 4, '0'), 'plan_line',
                            (ARRAY['revenue','cost_of_sales','payroll','marketing','premises','other_operating','interest','tax','excluded'])[1 + a % 9]) FROM generate_series(1, 1000) a) y;
INSERT INTO fpa_test.payload
SELECT 'save', jsonb_agg(jsonb_build_object('id', l.id, 'amount', to_char(l.amount + 1.25, 'FM999999990.00')))
  FROM fpa.plan_lines l WHERE l.version_id = (SELECT id FROM fpa_test.ids WHERE k = 'version');

-- From here every statement runs as the authenticated role with an 8s limit per statement.
SELECT set_config('request.jwt.claims', '{"sub":"user_timingOwner","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SET LOCAL statement_timeout = '8s';

-- Untimed loads: the P&L actuals for variance.
DO $load$
BEGIN
  PERFORM fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'),
                             (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'act'), 'timing-act.csv');
END $load$;
DO $t1$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT format('added %s, removed %s', r ->> 'rows_added', r ->> 'rows_removed') FROM (SELECT fpa.import_balances((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'bal_big'), 'timing-bal-' || '1' || '.csv') AS r) x);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_balances: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_balances: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t1$;

DO $t2$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT format('added %s, removed %s', r ->> 'rows_added', r ->> 'rows_removed') FROM (SELECT fpa.import_balances((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'bal_big'), 'timing-bal-' || '2' || '.csv') AS r) x);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_balances: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_balances: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t2$;

DO $t3$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT format('added %s, removed %s', r ->> 'rows_added', r ->> 'rows_removed') FROM (SELECT fpa.import_balances((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'bal_big'), 'timing-bal-' || '3' || '.csv') AS r) x);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_balances: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_balances: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t3$;

DO $t4$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := 'changed ' || fpa.set_line_map((SELECT id FROM fpa_test.ids WHERE k = 'connection'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'map'));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('set_line_map: 2,000 accounts (untimed setup for the next calls; shown for reference)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('set_line_map: 2,000 accounts (untimed setup for the next calls; shown for reference)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t4$;

DO $t5$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.balance_accounts((SELECT id FROM fpa_test.ids WHERE k = 'entity')));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('balance_accounts: 1,000 accounts, 20,000 balance rows', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('balance_accounts: 1,000 accounts, 20,000 balance rows', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t5$;

DO $t6$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.balance_accounts((SELECT id FROM fpa_test.ids WHERE k = 'entity')));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('balance_accounts: 1,000 accounts, 20,000 balance rows', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('balance_accounts: 1,000 accounts, 20,000 balance rows', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t6$;

DO $t7$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.balance_accounts((SELECT id FROM fpa_test.ids WHERE k = 'entity')));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('balance_accounts: 1,000 accounts, 20,000 balance rows', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('balance_accounts: 1,000 accounts, 20,000 balance rows', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t7$;

DO $t8$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT string_agg(to_char(c.month, 'YYYY-MM') || ':' || coalesce(c.cash::text, 'null'), ' ' ORDER BY c.month DESC) FROM fpa.cash_position((SELECT id FROM fpa_test.ids WHERE k = 'entity')) c);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('cash_position: 20,000 balance rows, 10 cash accounts', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('cash_position: 20,000 balance rows, 10 cash accounts', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t8$;

DO $t9$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT string_agg(to_char(c.month, 'YYYY-MM') || ':' || coalesce(c.cash::text, 'null'), ' ' ORDER BY c.month DESC) FROM fpa.cash_position((SELECT id FROM fpa_test.ids WHERE k = 'entity')) c);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('cash_position: 20,000 balance rows, 10 cash accounts', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('cash_position: 20,000 balance rows, 10 cash accounts', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t9$;

DO $t10$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT string_agg(to_char(c.month, 'YYYY-MM') || ':' || coalesce(c.cash::text, 'null'), ' ' ORDER BY c.month DESC) FROM fpa.cash_position((SELECT id FROM fpa_test.ids WHERE k = 'entity')) c);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('cash_position: 20,000 balance rows, 10 cash accounts', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('cash_position: 20,000 balance rows, 10 cash accounts', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t10$;

DO $t11$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := 'saved ' || fpa.save_budget_lines((SELECT id FROM fpa_test.ids WHERE k = 'version'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'save'));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('save_budget_lines: 1,200 lines (the most allowed), all or nothing', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('save_budget_lines: 1,200 lines (the most allowed), all or nothing', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t11$;

DO $t12$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := 'saved ' || fpa.save_budget_lines((SELECT id FROM fpa_test.ids WHERE k = 'version'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'save'));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('save_budget_lines: 1,200 lines (the most allowed), all or nothing', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('save_budget_lines: 1,200 lines (the most allowed), all or nothing', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t12$;

DO $t13$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := 'saved ' || fpa.save_budget_lines((SELECT id FROM fpa_test.ids WHERE k = 'version'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'save'));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('save_budget_lines: 1,200 lines (the most allowed), all or nothing', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('save_budget_lines: 1,200 lines (the most allowed), all or nothing', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t13$;

DO $t14$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.variance((SELECT id FROM fpa_test.ids WHERE k = 'entity'), NULL, DATE '2024-01-01', DATE '2025-08-01'));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance (replaced in 0004): 20 months, 1,000 accounts, 10 on Cash and bank', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance (replaced in 0004): 20 months, 1,000 accounts, 10 on Cash and bank', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t14$;

DO $t15$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.variance((SELECT id FROM fpa_test.ids WHERE k = 'entity'), NULL, DATE '2024-01-01', DATE '2025-08-01'));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance (replaced in 0004): 20 months, 1,000 accounts, 10 on Cash and bank', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance (replaced in 0004): 20 months, 1,000 accounts, 10 on Cash and bank', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t15$;

DO $t16$ DECLARE t0 timestamptz := clock_timestamp(); v text;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.variance((SELECT id FROM fpa_test.ids WHERE k = 'entity'), NULL, DATE '2024-01-01', DATE '2025-08-01'));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance (replaced in 0004): 20 months, 1,000 accounts, 10 on Cash and bank', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance (replaced in 0004): 20 months, 1,000 accounts, 10 on Cash and bank', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t16$;

RESET ROLE;
DO $report$
DECLARE v_out text;
BEGIN
  SELECT string_agg(format('worst %s ms (runs: %s) | %s | %s', w.worst, w.runs, w.label, w.detail), E'\n' ORDER BY w.first_n) INTO v_out
    FROM (SELECT t.label, min(t.n) AS first_n, max(t.ms) AS worst, string_agg(t.ms::text, ', ' ORDER BY t.run) AS runs,
                 string_agg(DISTINCT left(t.detail, 200), '; ') AS detail
            FROM fpa_test.timing t GROUP BY t.label) w;
  RAISE EXCEPTION E'Timings (authenticated, statement_timeout %, per call, 3 runs each):\n%\nBalance rows in fpa: %, actual rows: % (entities: %). Slowest single call: % ms.',
    current_setting('statement_timeout'), v_out, (SELECT count(*) FROM fpa.balances_monthly), (SELECT count(*) FROM fpa.actuals_monthly),
    (SELECT count(*) FROM fpa.entities), (SELECT max(ms) FROM fpa_test.timing);
END $report$;
