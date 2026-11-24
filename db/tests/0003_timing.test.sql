-- Timing of the 0003 functions at their limits, as the authenticated role with statement_timeout 8s
-- (the role's setting on this project: pg_roles.rolconfig for authenticated is statement_timeout=8s).
-- Runs after 0003 in one transaction (db/bundle.mjs builds db/out/timing_0003.sql: BEGIN; 0003; this
-- file). Payloads are built first as the table owner, untimed. Each timed call is its own top-level
-- statement, so the 8s timeout applies to each call separately; a call that is cancelled is recorded as
-- such and its changes undone, and the run goes on. The report raises, so everything rolls back.
-- Made-up data only.
CREATE SCHEMA fpa_test;
CREATE TABLE fpa_test.payload (k text PRIMARY KEY, v jsonb);
CREATE TABLE fpa_test.timing (n serial, label text, ms numeric, detail text);
CREATE TABLE fpa_test.ids (k text PRIMARY KEY, id uuid);
GRANT USAGE ON SCHEMA fpa_test TO authenticated;
GRANT SELECT ON fpa_test.payload, fpa_test.ids TO authenticated;
GRANT INSERT ON fpa_test.timing TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA fpa_test TO authenticated;

-- Fixtures through the API path, as a made-up owner.
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
-- 2025-08), each with a 160-character name, so just under the 5 MB limit. imp_old and imp_gap: accounts
-- A0001-A1500 for 2022-09 to 2023-12 (16 months, 24,000 rows, sent as two imports). map: all 1,500
-- accounts spread over the mappable lines.
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
  FROM generate_series(1, 1500) a;

-- From here every statement runs as the authenticated role with an 8s limit per statement.
SELECT set_config('request.jwt.claims', '{"sub":"user_timingOwner","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SET LOCAL statement_timeout = '8s';

DO $t1$ DECLARE t0 timestamptz := clock_timestamp(); v jsonb;
BEGIN
  v := fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'),
                          (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'imp_big'), 'timing-big.csv');
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('import_actuals: 20,000 rows, first load (20 months x 1,000 accounts)',
    round(extract(epoch FROM clock_timestamp() - t0) * 1000), format('added %s, removed %s, payload %s bytes', v ->> 'rows_added', v ->> 'rows_removed',
    (SELECT octet_length(p.v::text) FROM fpa_test.payload p WHERE p.k = 'imp_big')));
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t1: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t1$;

DO $t2$ DECLARE t0 timestamptz := clock_timestamp(); v jsonb;
BEGIN
  v := fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'),
                          (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'imp_big'), 'timing-big-again.csv');
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('import_actuals: same 20,000 rows again (replaces all 20 months)',
    round(extract(epoch FROM clock_timestamp() - t0) * 1000), format('added %s, removed %s', v ->> 'rows_added', v ->> 'rows_removed'));
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t2: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t2$;

DO $t3$ DECLARE t0 timestamptz := clock_timestamp(); v jsonb;
BEGIN
  v := fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'),
                          (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'imp_old'), 'timing-old.csv');
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('import_actuals: 18,000 rows (12 months x 1,500 accounts)',
    round(extract(epoch FROM clock_timestamp() - t0) * 1000), format('added %s', v ->> 'rows_added'));
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t3: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t3$;

DO $t4$ DECLARE t0 timestamptz := clock_timestamp(); v jsonb;
BEGIN
  v := fpa.import_actuals((SELECT id FROM fpa_test.ids WHERE k = 'entity'), (SELECT id FROM fpa_test.ids WHERE k = 'connection'),
                          (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'imp_gap'), 'timing-gap.csv');
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('import_actuals: 6,000 rows (4 months x 1,500 accounts)',
    round(extract(epoch FROM clock_timestamp() - t0) * 1000), format('added %s', v ->> 'rows_added'));
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t4: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t4$;

DO $t5$ DECLARE t0 timestamptz := clock_timestamp(); v integer;
BEGIN
  v := fpa.set_line_map((SELECT id FROM fpa_test.ids WHERE k = 'connection'), (SELECT p.v FROM fpa_test.payload p WHERE p.k = 'map'));
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('set_line_map: 1,500 accounts', round(extract(epoch FROM clock_timestamp() - t0) * 1000), format('changed %s', v));
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t5: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t5$;

DO $t6$ DECLARE t0 timestamptz := clock_timestamp(); v bigint;
BEGIN
  SELECT count(*) INTO v FROM fpa.account_map((SELECT id FROM fpa_test.ids WHERE k = 'entity'));
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('account_map: 1,500 accounts over 50,000 actual rows', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    format('%s rows returned', v));
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t6: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t6$;

DO $t7$ DECLARE t0 timestamptz := clock_timestamp(); v bigint;
BEGIN
  SELECT count(*) INTO v FROM fpa.unmapped_accounts((SELECT id FROM fpa_test.ids WHERE k = 'entity'));
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('unmapped_accounts: same entity', round(extract(epoch FROM clock_timestamp() - t0) * 1000), format('%s rows returned', v));
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t7: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t7$;

DO $t8$ DECLARE t0 timestamptz := clock_timestamp(); v uuid;
BEGIN
  v := fpa.create_budget_from_actuals((SELECT id FROM fpa_test.ids WHERE k = 'plan'), NULL, 'Timing budget', DATE '2024-01-01', DATE '2025-01-01',
                                      '{"revenue": 5, "payroll": "2.5", "premises": -3}'::jsonb);
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('create_budget_from_actuals: 12-month window over 1,500 mapped accounts',
    round(extract(epoch FROM clock_timestamp() - t0) * 1000), format('%s budget lines', (SELECT count(*) FROM fpa.plan_lines l WHERE l.version_id = v)));
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t8: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t8$;

DO $t9$ DECLARE t0 timestamptz := clock_timestamp(); v bigint; v_version uuid;
BEGIN
  SELECT pv.id INTO v_version FROM fpa.plan_versions pv WHERE pv.name = 'Timing budget';
  SELECT count(*) INTO v FROM fpa.variance((SELECT id FROM fpa_test.ids WHERE k = 'entity'), v_version, DATE '2022-09-01', DATE '2025-08-01');
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('variance: 36 months (2022-09 to 2025-08) with a budget', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    format('%s rows returned', v));
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t9: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t9$;

DO $t10$ DECLARE t0 timestamptz := clock_timestamp(); v uuid;
BEGIN
  SELECT pv.id INTO v FROM fpa.plan_versions pv WHERE pv.name = 'Timing budget';
  IF v IS NULL THEN
    INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('create_budget_from_actuals: rebuild over the same version', NULL, 'skipped: no version (the first build did not finish)');
    RETURN;
  END IF;
  PERFORM fpa.create_budget_from_actuals((SELECT id FROM fpa_test.ids WHERE k = 'plan'), v, NULL, DATE '2024-01-01', DATE '2025-01-01', '{}'::jsonb);
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('create_budget_from_actuals: rebuild over the same version', round(extract(epoch FROM clock_timestamp() - t0) * 1000), NULL);
EXCEPTION WHEN query_canceled THEN
  INSERT INTO fpa_test.timing (label, ms, detail) VALUES ('t10: cancelled', round(extract(epoch FROM clock_timestamp() - t0) * 1000),
    'CANCELLED by statement_timeout (8s); this call''s changes were undone');
END $t10$;

RESET ROLE;
DO $report$
DECLARE v_out text;
BEGIN
  SELECT string_agg(format('%s ms | %s | %s', t.ms, t.label, coalesce(t.detail, '')), E'\n' ORDER BY t.n) INTO v_out FROM fpa_test.timing t;
  RAISE EXCEPTION E'Timings (authenticated, statement_timeout %, per call):\n%\nActual rows for the entity: %. Slowest: % ms.',
    current_setting('statement_timeout'), v_out, (SELECT count(*) FROM fpa.actuals_monthly), (SELECT max(ms) FROM fpa_test.timing);
END $report$;
