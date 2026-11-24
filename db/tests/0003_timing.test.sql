-- Timing of the 0003 functions at their limits, as the authenticated role with statement_timeout 8s
-- (the role's setting on this project: pg_roles.rolconfig for authenticated is statement_timeout=8s).
-- Runs after 0003 in one transaction (db/bundle.mjs builds db/out/timing_0003.sql: BEGIN; 0003; this
-- file). Realistic load: 50 other entities (200 accounts x 24 months each, 240,000 actual rows, all
-- mapped) sit alongside the test entity, and the timing user is also a viewer of 5 of them.
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
    INSERT INTO fpa.line_map (connection_id, account_code, plan_line)
    SELECT v_c, 'X' || lpad(a::text, 4, '0'), (ARRAY['revenue','cost_of_sales','payroll','marketing','premises','other_operating','interest','tax','excluded'])[1 + a % 9]
      FROM generate_series(1, 200) a;
  END LOOP;
END $others$;
ANALYZE fpa.actuals_monthly;
ANALYZE fpa.line_map;
ANALYZE fpa.entity_members;
ANALYZE fpa.connections;

-- The test entity, through the API path, as a made-up owner.
DO $fix$
DECLARE v_e uuid; v_c uuid; v_p uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"user_timingOwner","role":"authenticated"}', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_e := fpa.create_entity('Timing Test Ltd', 'IE', 'EUR', 1::smallint);
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_e, 'csv') RETURNING id INTO v_c;
  SELECT p.id INTO v_p FROM fpa.plans p WHERE p.entity_id = v_e;
  EXECUTE 'RESET ROLE';
  INSERT INTO fpa_test.ids VALUES ('entity', v_e), ('connection', v_c), ('plan', v_p);
END $fix$;

-- Payloads (untimed). imp_big: exactly 20,000 rows, accounts A0001-A1000 x 20 months (2024-01 to
-- 2025-08), 160-character names, just under 5 MB. imp_old and imp_gap: A0001-A1500 for 2022-09 to
-- 2023-12 (24,000 rows, loaded untimed). map: A0001-A1470 mapped; A1471-A1500 (no actuals in 2024)
-- left unmapped, so unmapped_accounts has work to report.
INSERT INTO fpa_test.payload
SELECT 'imp_big', jsonb_agg(jsonb_build_object('account_code', 'A' || lpad(a::text, 4, '0'), 'account_name', rpad('Account ' || a, 160, '.'),
                                               'month', to_char(DATE '2024-01-01' + make_interval(months => m), 'YYYY-MM-DD'),
                                               'amount', to_char(((a * 37 + m * 11) % 9000 - 4500) + 0.37, 'FM999999990.00')))
  FROM generate_series(1, 1000) a, generate_series(0, 19) m;
INSERT INTO fpa_test.payload
SELECT 'imp_old', jsonb_agg(jsonb_build_object('account_code', 'A' || lpad(a::text, 4, '0'),
                                               'month', to_char(DATE '2022-09-01' + make_interval(months => m), 'YYYY-MM-DD'),
                                               'amount', to_char(((a * 13 + m * 7) % 5000 - 2500) + 0.11, 'FM999999990.00')))
  FROM generate_series(1, 1500) a, generate_series(0, 11) m;
INSERT INTO fpa_test.payload
SELECT 'imp_gap', jsonb_agg(jsonb_build_object('account_code', 'A' || lpad(a::text, 4, '0'),
                                               'month', to_char(DATE '2023-09-01' + make_interval(months => m), 'YYYY-MM-DD'),
                                               'amount', to_char(((a * 17 + m * 5) % 3000 - 1500) + 0.05, 'FM999999990.00')))
  FROM generate_series(1, 1500) a, generate_series(0, 3) m;
INSERT INTO fpa_test.payload
SELECT 'map', jsonb_agg(jsonb_build_object('account_code', 'A' || lpad(a::text, 4, '0'),
                                           'plan_line', (ARRAY['revenue','cost_of_sales','payroll','marketing','premises','other_operating','interest','tax','excluded'])[1 + a % 9]))
  FROM generate_series(1, 1470) a;

-- From here every statement runs as the authenticated role with an 8s limit per statement.
SELECT set_config('request.jwt.claims', '{"sub":"user_timingOwner","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SET LOCAL statement_timeout = '8s';

-- Untimed loads of the older months, and the line map.
DO $load$
BEGIN
  PERFORM fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'),
                             (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'imp_old'), 'timing-old.csv');
  PERFORM fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'),
                             (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'imp_gap'), 'timing-gap.csv');
END $load$;
DO $t1$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := (SELECT format('added %s, removed %s', r ->> 'rows_added', r ->> 'rows_removed') FROM (SELECT fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'imp_big'), 'timing-big-1.csv') AS r) x);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_actuals: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_actuals: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t1$;

DO $t2$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := (SELECT format('added %s, removed %s', r ->> 'rows_added', r ->> 'rows_removed') FROM (SELECT fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'imp_big'), 'timing-big-2.csv') AS r) x);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_actuals: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_actuals: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t2$;

DO $t3$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := (SELECT format('added %s, removed %s', r ->> 'rows_added', r ->> 'rows_removed') FROM (SELECT fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'imp_big'), 'timing-big-3.csv') AS r) x);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_actuals: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('import_actuals: 20,000 rows, about 5 MB (run 1 loads, runs 2-3 replace all 20 months)', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t3$;

DO $t4$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := 'changed ' || fpa.set_line_map((SELECT id FROM fpa_test.ids WHERE k = 'connection'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'map'));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('set_line_map: 1,470 accounts (untimed setup for the next calls; shown for reference)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('set_line_map: 1,470 accounts (untimed setup for the next calls; shown for reference)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t4$;

DO $t5$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.account_map((SELECT id FROM fpa_test.ids WHERE k = 'entity')));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('account_map: 1,500 accounts, 44,000 actual rows', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('account_map: 1,500 accounts, 44,000 actual rows', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t5$;

DO $t6$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.account_map((SELECT id FROM fpa_test.ids WHERE k = 'entity')));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('account_map: 1,500 accounts, 44,000 actual rows', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('account_map: 1,500 accounts, 44,000 actual rows', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t6$;

DO $t7$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.account_map((SELECT id FROM fpa_test.ids WHERE k = 'entity')));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('account_map: 1,500 accounts, 44,000 actual rows', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('account_map: 1,500 accounts, 44,000 actual rows', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t7$;

DO $t8$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.unmapped_accounts((SELECT id FROM fpa_test.ids WHERE k = 'entity')));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('unmapped_accounts: same entity', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('unmapped_accounts: same entity', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t8$;

DO $t9$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.unmapped_accounts((SELECT id FROM fpa_test.ids WHERE k = 'entity')));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('unmapped_accounts: same entity', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('unmapped_accounts: same entity', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t9$;

DO $t10$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v := (SELECT count(*) || ' rows' FROM fpa.unmapped_accounts((SELECT id FROM fpa_test.ids WHERE k = 'entity')));
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('unmapped_accounts: same entity', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('unmapped_accounts: same entity', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t10$;

DO $t11$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v_id := fpa.create_budget_from_actuals((SELECT id FROM fpa_test.ids WHERE k = 'plan'), NULL, 'Timing budget 1', DATE '2024-01-01', DATE '2025-01-01', '{"revenue": 5, "payroll": "2.5", "premises": -3}'::jsonb);
  v := (SELECT count(*) || ' budget lines' FROM fpa.plan_lines l WHERE l.version_id = v_id);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('create_budget_from_actuals: 12-month window, 1,500 accounts (a new version each run)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('create_budget_from_actuals: 12-month window, 1,500 accounts (a new version each run)', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t11$;

DO $t12$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v_id := fpa.create_budget_from_actuals((SELECT id FROM fpa_test.ids WHERE k = 'plan'), NULL, 'Timing budget 2', DATE '2024-01-01', DATE '2025-01-01', '{"revenue": 5, "payroll": "2.5", "premises": -3}'::jsonb);
  v := (SELECT count(*) || ' budget lines' FROM fpa.plan_lines l WHERE l.version_id = v_id);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('create_budget_from_actuals: 12-month window, 1,500 accounts (a new version each run)', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('create_budget_from_actuals: 12-month window, 1,500 accounts (a new version each run)', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t12$;

DO $t13$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v_id := fpa.create_budget_from_actuals((SELECT id FROM fpa_test.ids WHERE k = 'plan'), NULL, 'Timing budget 3', DATE '2024-01-01', DATE '2025-01-01', '{"revenue": 5, "payroll": "2.5", "premises": -3}'::jsonb);
  v := (SELECT count(*) || ' budget lines' FROM fpa.plan_lines l WHERE l.version_id = v_id);
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('create_budget_from_actuals: 12-month window, 1,500 accounts (a new version each run)', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('create_budget_from_actuals: 12-month window, 1,500 accounts (a new version each run)', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t13$;

DO $t14$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v_id := (SELECT pv.id FROM fpa.plan_versions pv WHERE pv.name = 'Timing budget 1');
  v := (SELECT count(*) || ' rows' FROM fpa.variance((SELECT id FROM fpa_test.ids WHERE k = 'entity'), v_id, DATE '2022-09-01', DATE '2025-08-01')) || CASE WHEN v_id IS NULL THEN ' (no budget: the budget call did not finish)' ELSE ', with budget' END;
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance: 36 months (2022-09 to 2025-08) with a budget', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance: 36 months (2022-09 to 2025-08) with a budget', 1, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t14$;

DO $t15$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v_id := (SELECT pv.id FROM fpa.plan_versions pv WHERE pv.name = 'Timing budget 1');
  v := (SELECT count(*) || ' rows' FROM fpa.variance((SELECT id FROM fpa_test.ids WHERE k = 'entity'), v_id, DATE '2022-09-01', DATE '2025-08-01')) || CASE WHEN v_id IS NULL THEN ' (no budget: the budget call did not finish)' ELSE ', with budget' END;
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance: 36 months (2022-09 to 2025-08) with a budget', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance: 36 months (2022-09 to 2025-08) with a budget', 2, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t15$;

DO $t16$ DECLARE t0 timestamptz := clock_timestamp(); v text; v_id uuid;
BEGIN
  v_id := (SELECT pv.id FROM fpa.plan_versions pv WHERE pv.name = 'Timing budget 1');
  v := (SELECT count(*) || ' rows' FROM fpa.variance((SELECT id FROM fpa_test.ids WHERE k = 'entity'), v_id, DATE '2022-09-01', DATE '2025-08-01')) || CASE WHEN v_id IS NULL THEN ' (no budget: the budget call did not finish)' ELSE ', with budget' END;
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance: 36 months (2022-09 to 2025-08) with a budget', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000), v);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, run, ms, detail) VALUES ('variance: 36 months (2022-09 to 2025-08) with a budget', 3, round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t16$;

RESET ROLE;
DO $report$
DECLARE v_out text;
BEGIN
  SELECT string_agg(format('worst %s ms (runs: %s) | %s | %s', w.worst, w.runs, w.label, w.detail), E'\n' ORDER BY w.first_n) INTO v_out
    FROM (SELECT t.label, min(t.n) AS first_n, max(t.ms) AS worst, string_agg(t.ms::text, ', ' ORDER BY t.run) AS runs,
                 string_agg(DISTINCT t.detail, '; ') AS detail
            FROM fpa_test.timing t GROUP BY t.label) w;
  RAISE EXCEPTION E'Timings (authenticated, statement_timeout %, per call, 3 runs each):\n%\nActual rows in fpa: % (entities: %). Slowest single call: % ms.',
    current_setting('statement_timeout'), v_out, (SELECT count(*) FROM fpa.actuals_monthly), (SELECT count(*) FROM fpa.entities),
    (SELECT max(ms) FROM fpa_test.timing);
END $report$;
