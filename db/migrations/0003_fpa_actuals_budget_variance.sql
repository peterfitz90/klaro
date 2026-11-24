-- 0003: Klaro Phase 1. Actuals import, line map, budget from actuals, variance.
-- Applied only with Peter's approval, as plain SQL in one transaction (db/out/apply_0003.sql, built by
-- db/bundle.mjs), which also records this file and its checksum in fpa.schema_migrations and runs
-- db/apply_checks_0003.sql before COMMIT. Not through Supabase's migration feature, so Supabase's own
-- migration history is unchanged. Touches nothing outside the fpa schema.
--
-- What it adds
--   fpa.plan_line_defs   the fixed Phase 1 plan-line list (reference data; no API role writes it).
--   fpa.sync_runs        one row per successful import (failed imports roll back, log row included).
--   actuals_monthly.account_name, and foreign keys so line_map and plan_lines can only name a line
--   from the list (mapped accounts: an income, cost or excluded line; budget lines: income or cost).
--   plan_lines.origin gains 'from_actuals'.
--   Functions:
--     import_actuals              SECURITY DEFINER (the API cannot write actuals): editor or owner;
--                                 replaces whole months for one connection, in one transaction.
--     set_line_map, account_map, unmapped_accounts, variance, create_budget_from_actuals:
--                                 SECURITY INVOKER, so row security and the lock triggers apply.
--     my_entity_ids               SECURITY DEFINER helper: the caller's own entities at a minimum role.
--   Read policies on actuals_monthly and line_map use my_entity_ids once per query instead of a
--   membership check per row (same rule: active member, viewer or above). Measured need: at 44,000
--   actual rows the per-row checks took over 8 seconds (docs/reports/P1-A-timing.md).
-- Sign convention: actuals and budget amounts are stored trial-balance style (debits positive,
-- credits negative). plan_line_defs.display_sign turns them into screen figures (revenue positive).
-- Rounding (budget from actuals): full precision, round half away from zero to cents; the last month
-- takes the rest so the 12 months sum exactly to the rounded annual figure (src/engine/rounding.ts).

-- ── Plan-line list ───────────────────────────────────────────────────────────────────────────
CREATE TABLE fpa.plan_line_defs (
  key          text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label        text NOT NULL UNIQUE CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  kind         text NOT NULL CHECK (kind IN ('income', 'cost', 'calculated', 'unmapped', 'excluded')),
  sort_order   smallint NOT NULL UNIQUE CHECK (sort_order > 0),
  display_sign smallint NOT NULL CHECK (display_sign IN (-1, 1)),   -- screen figure = display_sign * stored amount
  mappable     boolean GENERATED ALWAYS AS (kind IN ('income', 'cost', 'excluded')) STORED,   -- an account can be mapped to it
  budgetable   boolean GENERATED ALWAYS AS (kind IN ('income', 'cost')) STORED,               -- a budget line can be stored on it
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, mappable),
  UNIQUE (key, budgetable)
);
-- Calculated lines add up every income and cost line above them (lower sort_order).
INSERT INTO fpa.plan_line_defs (key, label, kind, sort_order, display_sign) VALUES
  ('revenue',          'Revenue',                   'income',     10, -1),
  ('cost_of_sales',    'Cost of sales',             'cost',       20,  1),
  ('gross_profit',     'Gross profit',              'calculated', 30, -1),
  ('payroll',          'Payroll',                   'cost',       40,  1),
  ('marketing',        'Marketing',                 'cost',       50,  1),
  ('premises',         'Rent and premises',         'cost',       60,  1),
  ('other_operating',  'Other operating costs',     'cost',       70,  1),
  ('operating_profit', 'Operating profit',          'calculated', 80, -1),
  ('interest',         'Interest',                  'cost',       90,  1),
  ('tax',              'Tax',                       'cost',      100,  1),
  ('net_profit',       'Net profit',                'calculated', 110, -1),
  ('unmapped',         'Unmapped',                  'unmapped',  120,  1),
  ('excluded',         'Not in the P&L (excluded)', 'excluded',  130,  1);

-- ── Sync log ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE fpa.sync_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL,
  connection_id   uuid NOT NULL,
  run_by          text NOT NULL CHECK (run_by ~ '^user_[A-Za-z0-9]{1,64}$'),   -- Clerk user id
  source_name     text NOT NULL CHECK (length(source_name) BETWEEN 1 AND 200),
  months_replaced date[] NOT NULL CHECK (cardinality(months_replaced) BETWEEN 1 AND 1200),
  rows_removed    integer NOT NULL CHECK (rows_removed >= 0),
  rows_added      integer NOT NULL CHECK (rows_added >= 0),
  status          text NOT NULL CHECK (status IN ('succeeded', 'failed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (connection_id, entity_id) REFERENCES fpa.connections (id, entity_id)
);
CREATE INDEX sync_runs_connection ON fpa.sync_runs (connection_id, created_at DESC);
CREATE INDEX sync_runs_entity ON fpa.sync_runs (entity_id, created_at DESC);

-- ── Changes to Phase 0 tables ────────────────────────────────────────────────────────────────
ALTER TABLE fpa.actuals_monthly ADD COLUMN account_name text CHECK (length(account_name) BETWEEN 1 AND 200);
CREATE INDEX actuals_monthly_connection_period ON fpa.actuals_monthly (connection_id, period);

-- line_map.plan_line must be a mappable line; plan_lines.plan_line a budgetable one. The constant
-- columns exist only to carry the foreign keys (always true).
ALTER TABLE fpa.line_map ADD COLUMN mappable boolean NOT NULL DEFAULT true CHECK (mappable);
ALTER TABLE fpa.line_map ADD CONSTRAINT line_map_plan_line_def
  FOREIGN KEY (plan_line, mappable) REFERENCES fpa.plan_line_defs (key, mappable);
CREATE INDEX line_map_plan_line ON fpa.line_map (plan_line);
ALTER TABLE fpa.plan_lines ADD COLUMN budgetable boolean NOT NULL DEFAULT true CHECK (budgetable);
ALTER TABLE fpa.plan_lines ADD CONSTRAINT plan_lines_plan_line_def
  FOREIGN KEY (plan_line, budgetable) REFERENCES fpa.plan_line_defs (key, budgetable);
CREATE INDEX plan_lines_plan_line ON fpa.plan_lines (plan_line);
ALTER TABLE fpa.plan_lines DROP CONSTRAINT plan_lines_origin_check;
ALTER TABLE fpa.plan_lines ADD CONSTRAINT plan_lines_origin_check CHECK (origin IN ('actual', 'driver', 'manual', 'from_actuals'));

CREATE TRIGGER plan_line_defs_updated_at BEFORE UPDATE ON fpa.plan_line_defs FOR EACH ROW EXECUTE FUNCTION fpa.touch_updated_at();
CREATE TRIGGER sync_runs_updated_at BEFORE UPDATE ON fpa.sync_runs FOR EACH ROW EXECUTE FUNCTION fpa.touch_updated_at();

-- ── Faster read policies (same access rule) ───────────────────────────────────────────────
-- The caller's own entities where they are an active member with at least p_min_role. Only ever about
-- the caller (auth.jwt()->>'sub'). Used inside ARRAY(SELECT ...) in the policies below, so it runs once
-- per query rather than once per row.
CREATE FUNCTION fpa.my_entity_ids(p_min_role text DEFAULT 'viewer') RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT m.entity_id FROM fpa.entity_members m
   WHERE m.clerk_user_id = (SELECT auth.jwt() ->> 'sub')
     AND m.is_active
     AND CASE m.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END
         >= CASE p_min_role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END;
$$;
ALTER POLICY actuals_monthly_read ON fpa.actuals_monthly
  USING (entity_id = ANY (ARRAY(SELECT fpa.my_entity_ids('viewer'))));
ALTER POLICY line_map_read ON fpa.line_map
  USING (connection_id IN (SELECT c.id FROM fpa.connections c WHERE c.entity_id = ANY (ARRAY(SELECT fpa.my_entity_ids('viewer')))));

-- ── import_actuals ───────────────────────────────────────────────────────────────────────────
-- Imports monthly actuals for one CSV connection. p_rows is a JSON array of
--   {"account_code": "4000", "account_name": "Sales" (optional), "month": "2025-01-01", "amount": "-1200.50"}
-- (amount as a string or a number; trial-balance sign). Every row is checked first; then every month
-- present in the file is replaced completely for that connection (delete, then insert), the
-- connection's sync fields are set and a sync_runs row is written. One transaction: any error undoes
-- all of it. Limits: 20,000 rows and 5 MB of row data per import.
CREATE FUNCTION fpa.import_actuals(p_entity_id uuid, p_connection_id uuid, p_rows jsonb, p_source_name text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
DECLARE
  v_sub text := auth.jwt() ->> 'sub';
  v_source text := btrim(coalesce(p_source_name, ''));
  v_type text;
  v_status text;
  v_count integer;
  v_bad text;
  v_months date[];
  v_removed integer;
  v_added integer;
  v_through date;
  v_run uuid;
BEGIN
  IF v_sub IS NULL OR v_sub = '' THEN RAISE EXCEPTION 'Please sign in first.' USING ERRCODE = 'PT401'; END IF;
  IF p_entity_id IS NULL OR NOT fpa.is_entity_member(p_entity_id, 'editor') THEN
    RAISE EXCEPTION 'You need editor or owner access to this entity to import actuals.' USING ERRCODE = 'PT403';
  END IF;
  -- Locks the connection row: two imports into one connection run one after the other.
  SELECT c.source_type, c.status INTO v_type, v_status FROM fpa.connections c
   WHERE c.id = p_connection_id AND c.entity_id = p_entity_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That connection was not found for this entity.' USING ERRCODE = 'PT404'; END IF;
  IF v_type <> 'csv' THEN RAISE EXCEPTION 'Only a CSV connection can import a file.' USING ERRCODE = 'PT400'; END IF;
  IF v_status = 'disabled' THEN RAISE EXCEPTION 'This connection is disabled.' USING ERRCODE = 'PT409'; END IF;
  IF length(v_source) NOT BETWEEN 1 AND 200 OR v_source ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'The file name must be 1 to 200 characters.' USING ERRCODE = 'PT400';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RAISE EXCEPTION 'The rows must be a list.' USING ERRCODE = 'PT400'; END IF;
  v_count := jsonb_array_length(p_rows);
  IF v_count = 0 THEN RAISE EXCEPTION 'The file has no rows.' USING ERRCODE = 'PT400'; END IF;
  IF v_count > 20000 THEN
    RAISE EXCEPTION 'The file has % rows; the most one import can take is 20,000.', v_count USING ERRCODE = 'PT413';
  END IF;
  IF octet_length(p_rows::text) > 5242880 THEN
    RAISE EXCEPTION 'The rows are larger than 5 MB, the most one import can take.' USING ERRCODE = 'PT413';
  END IF;

  -- The first bad row, in file order (the browser shows them all; this is the server's own check).
  SELECT format('Row %s: %s', r.n, r.problem) INTO v_bad FROM (
    SELECT t.n, CASE
      WHEN jsonb_typeof(t.elem) <> 'object' THEN 'each row must be an object.'
      WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(t.elem) k(key) WHERE k.key NOT IN ('account_code', 'account_name', 'month', 'amount'))
        THEN 'only account_code, account_name, month and amount are allowed.'
      WHEN jsonb_typeof(t.elem -> 'account_code') IS DISTINCT FROM 'string' OR length(btrim(t.elem ->> 'account_code')) NOT BETWEEN 1 AND 64
           OR (t.elem ->> 'account_code') ~ '[[:cntrl:]]'
        THEN 'the account code must be 1 to 64 characters.'
      WHEN coalesce(jsonb_typeof(t.elem -> 'account_name'), 'null') NOT IN ('string', 'null')
           OR length(btrim(t.elem ->> 'account_name')) > 200 OR (t.elem ->> 'account_name') ~ '[[:cntrl:]]'
        THEN 'the account name must be text of at most 200 characters.'
      WHEN jsonb_typeof(t.elem -> 'month') IS DISTINCT FROM 'string' OR (t.elem ->> 'month') !~ '^\d{4}-(0[1-9]|1[0-2])-01$'
        THEN 'the month must be the first day of a month (YYYY-MM-01).'
      WHEN (t.elem ->> 'month')::date < DATE '2000-01-01' OR (t.elem ->> 'month')::date > date_trunc('month', now())::date
        THEN 'the month must be from January 2000 to this month.'
      WHEN coalesce(jsonb_typeof(t.elem -> 'amount'), 'null') NOT IN ('string', 'number')
           OR btrim(t.elem ->> 'amount') !~ '^-?\d{1,12}(\.\d{1,2})?$'
        THEN 'the amount must be a number with at most two decimals and 12 digits before the point.'
    END AS problem
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, n)
  ) r WHERE r.problem IS NOT NULL ORDER BY r.n LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '%', v_bad USING ERRCODE = 'PT400'; END IF;

  SELECT format('Account %s appears more than once for %s.', d.code, to_char(d.month, 'YYYY-MM')) INTO v_bad FROM (
    SELECT btrim(t.elem ->> 'account_code') AS code, (t.elem ->> 'month')::date AS month
      FROM jsonb_array_elements(p_rows) AS t(elem)
     GROUP BY 1, 2 HAVING count(*) > 1 ORDER BY 2, 1 LIMIT 1) d;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '%', v_bad USING ERRCODE = 'PT400'; END IF;

  SELECT array_agg(DISTINCT (t.elem ->> 'month')::date ORDER BY (t.elem ->> 'month')::date) INTO v_months
    FROM jsonb_array_elements(p_rows) AS t(elem);

  DELETE FROM fpa.actuals_monthly a WHERE a.connection_id = p_connection_id AND a.period = ANY (v_months);
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, account_name, period, amount)
  SELECT p_entity_id, p_connection_id, btrim(t.elem ->> 'account_code'), nullif(btrim(t.elem ->> 'account_name'), ''),
         (t.elem ->> 'month')::date, btrim(t.elem ->> 'amount')::numeric
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, n) ORDER BY t.n;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  SELECT max(a.period) INTO v_through FROM fpa.actuals_monthly a WHERE a.connection_id = p_connection_id;
  UPDATE fpa.connections c SET last_synced_at = now(), actuals_through = v_through, status = 'active' WHERE c.id = p_connection_id;
  INSERT INTO fpa.sync_runs (entity_id, connection_id, run_by, source_name, months_replaced, rows_removed, rows_added, status)
  VALUES (p_entity_id, p_connection_id, v_sub, v_source, v_months, v_removed, v_added, 'succeeded') RETURNING id INTO v_run;

  RETURN jsonb_build_object('sync_run_id', v_run, 'months_replaced', to_jsonb(v_months), 'rows_removed', v_removed,
                            'rows_added', v_added, 'actuals_through', v_through, 'last_synced_at', now());
END $$;

-- ── Line map ─────────────────────────────────────────────────────────────────────────────────
-- Sets the plan line for accounts of one connection. p_entries is a JSON array of
--   {"account_code": "4000", "plan_line": "revenue"}   (plan_line null removes the mapping).
-- Editor or owner. Runs as the caller: row security and the foreign key to plan_line_defs apply.
-- Returns the number of mappings added, changed or removed.
CREATE FUNCTION fpa.set_line_map(p_connection_id uuid, p_entries jsonb)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = fpa, pg_temp AS $$
DECLARE
  v_bad text;
  v_removed integer;
  v_set integer;
BEGIN
  IF p_connection_id IS NULL OR NOT fpa.member_for_connection(p_connection_id, 'editor') THEN
    RAISE EXCEPTION 'You need editor or owner access to change the line map.' USING ERRCODE = 'PT403';
  END IF;
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) NOT BETWEEN 1 AND 20000 THEN
    RAISE EXCEPTION 'Send a list of 1 to 20,000 mappings.' USING ERRCODE = 'PT400';
  END IF;
  SELECT format('Mapping %s: %s', r.n, r.problem) INTO v_bad FROM (
    SELECT t.n, CASE
      WHEN jsonb_typeof(t.elem) <> 'object' THEN 'each mapping must be an object.'
      WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(t.elem) k(key) WHERE k.key NOT IN ('account_code', 'plan_line'))
        THEN 'only account_code and plan_line are allowed.'
      WHEN jsonb_typeof(t.elem -> 'account_code') IS DISTINCT FROM 'string' OR length(t.elem ->> 'account_code') NOT BETWEEN 1 AND 64
        THEN 'the account code must be 1 to 64 characters.'
      WHEN coalesce(jsonb_typeof(t.elem -> 'plan_line'), 'null') NOT IN ('string', 'null') THEN 'the plan line must be a line key or null.'
      WHEN jsonb_typeof(t.elem -> 'plan_line') = 'string'
           AND NOT EXISTS (SELECT 1 FROM fpa.plan_line_defs d WHERE d.key = t.elem ->> 'plan_line' AND d.mappable)
        THEN format('%s is not a line an account can be mapped to.', t.elem ->> 'plan_line')
    END AS problem
    FROM jsonb_array_elements(p_entries) WITH ORDINALITY AS t(elem, n)
  ) r WHERE r.problem IS NOT NULL ORDER BY r.n LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '%', v_bad USING ERRCODE = 'PT400'; END IF;
  SELECT format('Account %s is listed more than once.', d.code) INTO v_bad FROM (
    SELECT t.elem ->> 'account_code' AS code FROM jsonb_array_elements(p_entries) AS t(elem) GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT 1) d;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '%', v_bad USING ERRCODE = 'PT400'; END IF;

  DELETE FROM fpa.line_map m
   WHERE m.connection_id = p_connection_id
     AND m.account_code IN (SELECT t.elem ->> 'account_code' FROM jsonb_array_elements(p_entries) AS t(elem)
                             WHERE jsonb_typeof(t.elem -> 'plan_line') IS DISTINCT FROM 'string');
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  INSERT INTO fpa.line_map AS m (connection_id, account_code, plan_line)
  SELECT p_connection_id, t.elem ->> 'account_code', t.elem ->> 'plan_line'
    FROM jsonb_array_elements(p_entries) AS t(elem) WHERE jsonb_typeof(t.elem -> 'plan_line') = 'string'
  ON CONFLICT (connection_id, account_code) DO UPDATE SET plan_line = excluded.plan_line
   WHERE m.plan_line IS DISTINCT FROM excluded.plan_line;
  GET DIAGNOSTICS v_set = ROW_COUNT;
  RETURN v_removed + v_set;
END $$;

-- Every account of the entity that has actuals or a mapping, unmapped accounts first. Runs as the
-- caller: a non-member gets no rows.
CREATE FUNCTION fpa.account_map(p_entity_id uuid)
RETURNS TABLE (connection_id uuid, account_code text, account_name text, plan_line text, months integer,
               first_month date, last_month date, total numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = fpa, pg_temp AS $$
  WITH acts AS (
    SELECT a.connection_id AS conn, a.account_code AS code,
           (array_agg(a.account_name ORDER BY a.period DESC) FILTER (WHERE a.account_name IS NOT NULL))[1] AS name,
           count(*)::integer AS n, min(a.period) AS first_p, max(a.period) AS last_p, sum(a.amount) AS amt
      FROM fpa.actuals_monthly a WHERE a.entity_id = p_entity_id
     GROUP BY a.connection_id, a.account_code),
  maps AS (
    SELECT m.connection_id AS conn, m.account_code AS code, m.plan_line AS line
      FROM fpa.line_map m JOIN fpa.connections c ON c.id = m.connection_id WHERE c.entity_id = p_entity_id)
  SELECT coalesce(x.conn, y.conn), coalesce(x.code, y.code), x.name, y.line, coalesce(x.n, 0), x.first_p, x.last_p, coalesce(x.amt, 0)
    FROM acts x FULL JOIN maps y ON y.conn = x.conn AND y.code = x.code
   ORDER BY (y.line IS NOT NULL), coalesce(x.code, y.code), coalesce(x.conn, y.conn);
$$;

-- Accounts with actuals but no mapping. While this returns any row, mapping is not complete.
CREATE FUNCTION fpa.unmapped_accounts(p_entity_id uuid)
RETURNS TABLE (connection_id uuid, account_code text, account_name text, months integer, last_month date, total numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = fpa, pg_temp AS $$
  SELECT m.connection_id, m.account_code, m.account_name, m.months, m.last_month, m.total
    FROM fpa.account_map(p_entity_id) m WHERE m.plan_line IS NULL AND m.months > 0
   ORDER BY m.account_code, m.connection_id;
$$;

-- ── Variance ─────────────────────────────────────────────────────────────────────────────────
-- Actual against budget per plan line and month, from p_from to p_to (first days of months; at most
-- 36 months). Budget is the base scenario of p_version_id (NULL: no budget). Every figure is in
-- display sign (revenue and profit positive). For each month:
--   actual   NULL when the entity has no actuals at all for that month, else the line's total (0 if none);
--   budget   NULL when the version has no budget lines in that month, else the line's total;
--   variance actual - budget (NULL if either is NULL);
--   variance_pct variance / |budget| * 100, NULL when budget is NULL or zero (never infinity);
--   favourable  income and profit lines: variance >= 0; cost lines: variance <= 0; Unmapped: NULL.
-- Calculated lines add up the income and cost lines above them; Unmapped and Excluded are left out of
-- them. Excluded is not returned. Runs as the caller: a non-member gets PT404.
CREATE FUNCTION fpa.variance(p_entity_id uuid, p_version_id uuid, p_from date, p_to date)
RETURNS TABLE (line_key text, line_label text, line_kind text, line_order smallint, month date,
               actual numeric, budget numeric, variance numeric, variance_pct numeric, favourable boolean)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = fpa, pg_temp AS $$
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_from <> date_trunc('month', p_from)::date OR p_to <> date_trunc('month', p_to)::date THEN
    RAISE EXCEPTION 'From and to must be the first days of months.' USING ERRCODE = 'PT400';
  END IF;
  IF p_to < p_from OR p_to > (p_from + interval '35 months')::date THEN
    RAISE EXCEPTION 'Choose a range of 1 to 36 months.' USING ERRCODE = 'PT400';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fpa.entities e WHERE e.id = p_entity_id) THEN
    RAISE EXCEPTION 'That entity was not found.' USING ERRCODE = 'PT404';
  END IF;
  IF p_version_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM fpa.plan_versions v JOIN fpa.plans p ON p.id = v.plan_id
                                               WHERE v.id = p_version_id AND p.entity_id = p_entity_id) THEN
    RAISE EXCEPTION 'That version was not found for this entity.' USING ERRCODE = 'PT404';
  END IF;

  -- Actuals and budget are each read once and summed per line and month; the grid is built from those
  -- small sums with joins.
  RETURN QUERY
  WITH mon AS (
    SELECT gs::date AS p FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 month') AS gs),
  act AS MATERIALIZED (
    SELECT coalesce(m.plan_line, 'unmapped') AS k, a.period AS p, sum(a.amount) AS amt
      FROM fpa.actuals_monthly a
      LEFT JOIN fpa.line_map m ON m.connection_id = a.connection_id AND m.account_code = a.account_code
     WHERE a.entity_id = p_entity_id AND a.period BETWEEN p_from AND p_to
     GROUP BY 1, 2),
  bud AS MATERIALIZED (
    SELECT l.plan_line AS k, l.period AS p, sum(l.amount) AS amt
      FROM fpa.plan_lines l JOIN fpa.scenarios s ON s.id = l.scenario_id AND s.is_base
     WHERE l.version_id = p_version_id AND l.period BETWEEN p_from AND p_to AND l.amount IS NOT NULL
     GROUP BY 1, 2),
  act_months AS (SELECT DISTINCT x.p FROM act x),
  bud_months AS (SELECT DISTINCT x.p FROM bud x),
  -- Calculated lines: the income and cost lines above them (lower sort_order), per month.
  act_calc AS (
    SELECT d.key AS k, x.p, sum(x.amt) AS amt
      FROM fpa.plan_line_defs d JOIN act x ON true JOIN fpa.plan_line_defs d2 ON d2.key = x.k
     WHERE d.kind = 'calculated' AND d2.kind IN ('income', 'cost') AND d2.sort_order < d.sort_order
     GROUP BY 1, 2),
  bud_calc AS (
    SELECT d.key AS k, x.p, sum(x.amt) AS amt
      FROM fpa.plan_line_defs d JOIN bud x ON true JOIN fpa.plan_line_defs d2 ON d2.key = x.k
     WHERE d.kind = 'calculated' AND d2.kind IN ('income', 'cost') AND d2.sort_order < d.sort_order
     GROUP BY 1, 2),
  grid AS (
    SELECT d.key AS k, d.label, d.kind, d.sort_order, d.display_sign, mo.p,
           CASE WHEN am.p IS NOT NULL THEN coalesce(CASE WHEN d.kind = 'calculated' THEN ac.amt ELSE ax.amt END, 0) END AS a_tb,
           CASE WHEN bm.p IS NOT NULL THEN coalesce(CASE WHEN d.kind = 'calculated' THEN bc.amt ELSE bx.amt END, 0) END AS b_tb
      FROM fpa.plan_line_defs d CROSS JOIN mon mo
      LEFT JOIN act_months am ON am.p = mo.p
      LEFT JOIN bud_months bm ON bm.p = mo.p
      LEFT JOIN act ax ON ax.k = d.key AND ax.p = mo.p
      LEFT JOIN act_calc ac ON ac.k = d.key AND ac.p = mo.p
      LEFT JOIN bud bx ON bx.k = d.key AND bx.p = mo.p
      LEFT JOIN bud_calc bc ON bc.k = d.key AND bc.p = mo.p
     WHERE d.kind <> 'excluded')
  SELECT g.k, g.label, g.kind, g.sort_order, g.p,
         g.display_sign * g.a_tb,
         g.display_sign * g.b_tb,
         g.display_sign * (g.a_tb - g.b_tb),
         CASE WHEN g.b_tb <> 0 THEN g.display_sign * (g.a_tb - g.b_tb) / abs(g.b_tb) * 100 END,
         CASE WHEN g.kind IN ('income', 'calculated') THEN g.display_sign * (g.a_tb - g.b_tb) >= 0
              WHEN g.kind = 'cost' THEN g.display_sign * (g.a_tb - g.b_tb) <= 0 END
    FROM grid g
   ORDER BY g.sort_order, g.p;
END $$;

-- ── Budget from actuals ──────────────────────────────────────────────────────────────────────
-- Copies 12 months of mapped actuals, from p_actuals_from, to a budget of 12 months from
-- p_budget_from, each line times (1 + uplift%). p_uplifts is a JSON object {"revenue": 5, "payroll":
-- "2.5", ...} (percent, -100 to 1000, at most two decimals; lines not named get 0).
-- p_version_id NULL creates a new budget version named p_name with a base scenario; otherwise the
-- 12 budget months of that version's base scenario are replaced (refused if the version is locked).
-- Refused unless every month of the window has actuals and every account with actuals in it is
-- mapped. Editor or owner; runs as the caller, so row security and the lock triggers apply.
-- Rounding: see the header (the last month takes the rest of the rounded annual figure).
CREATE FUNCTION fpa.create_budget_from_actuals(p_plan_id uuid, p_version_id uuid, p_name text, p_actuals_from date,
                                               p_budget_from date, p_uplifts jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = fpa, pg_temp AS $$
DECLARE
  v_entity uuid;
  v_version uuid := p_version_id;
  v_scenario uuid;
  v_kind text;
  v_locked timestamptz;
  v_bad text;
  v_uplifts jsonb := coalesce(p_uplifts, '{}'::jsonb);
BEGIN
  IF p_plan_id IS NULL OR NOT fpa.member_for_plan(p_plan_id, 'editor') THEN
    RAISE EXCEPTION 'You need editor or owner access to this plan.' USING ERRCODE = 'PT403';
  END IF;
  SELECT p.entity_id INTO v_entity FROM fpa.plans p WHERE p.id = p_plan_id;
  IF p_actuals_from IS NULL OR p_budget_from IS NULL OR p_actuals_from <> date_trunc('month', p_actuals_from)::date
     OR p_budget_from <> date_trunc('month', p_budget_from)::date THEN
    RAISE EXCEPTION 'The actuals window and the budget must start on the first day of a month.' USING ERRCODE = 'PT400';
  END IF;
  IF jsonb_typeof(v_uplifts) <> 'object' THEN RAISE EXCEPTION 'The uplifts must be an object of line: percent.' USING ERRCODE = 'PT400'; END IF;
  -- (CASE, not OR, so the cast only runs on text that has passed the pattern.)
  SELECT r.problem INTO v_bad FROM (
    SELECT u.key, CASE
             WHEN NOT EXISTS (SELECT 1 FROM fpa.plan_line_defs d WHERE d.key = u.key AND d.budgetable)
               THEN format('%s is not a line that can carry a budget.', u.key)
             WHEN jsonb_typeof(u.value) NOT IN ('number', 'string') OR btrim(u.value #>> '{}') !~ '^-?\d{1,4}(\.\d{1,2})?$'
               THEN format('The uplift for %s must be a percentage from -100 to 1000 with at most two decimals.', u.key)
             WHEN btrim(u.value #>> '{}')::numeric NOT BETWEEN -100 AND 1000
               THEN format('The uplift for %s must be a percentage from -100 to 1000 with at most two decimals.', u.key)
           END AS problem
      FROM jsonb_each(v_uplifts) AS u(key, value)) r
   WHERE r.problem IS NOT NULL ORDER BY r.key LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '%', v_bad USING ERRCODE = 'PT400'; END IF;
  IF v_version IS NOT NULL THEN
    SELECT v.kind, v.locked_at INTO v_kind, v_locked FROM fpa.plan_versions v WHERE v.id = v_version AND v.plan_id = p_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'That version was not found in this plan.' USING ERRCODE = 'PT404'; END IF;
    IF v_kind <> 'budget' THEN RAISE EXCEPTION 'That version is not a budget.' USING ERRCODE = 'PT400'; END IF;
    IF v_locked IS NOT NULL THEN RAISE EXCEPTION 'This version is locked. Unlock it first.' USING ERRCODE = 'PT423'; END IF;
  ELSIF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'The name must be 1 to 120 characters.' USING ERRCODE = 'PT400';
  END IF;

  IF (SELECT count(DISTINCT a.period) FROM fpa.actuals_monthly a
       WHERE a.entity_id = v_entity AND a.period >= p_actuals_from AND a.period < (p_actuals_from + interval '12 months')::date) < 12 THEN
    RAISE EXCEPTION 'Every month from % to % needs actuals before a budget can be built from them.',
      to_char(p_actuals_from, 'YYYY-MM'), to_char(p_actuals_from + interval '11 months', 'YYYY-MM') USING ERRCODE = 'PT409';
  END IF;
  SELECT string_agg(DISTINCT a.account_code, ', ' ORDER BY a.account_code) INTO v_bad
    FROM fpa.actuals_monthly a
   WHERE a.entity_id = v_entity AND a.period >= p_actuals_from AND a.period < (p_actuals_from + interval '12 months')::date
     AND NOT EXISTS (SELECT 1 FROM fpa.line_map m WHERE m.connection_id = a.connection_id AND m.account_code = a.account_code);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Map every account first. Unmapped: %', v_bad USING ERRCODE = 'PT409';
  END IF;

  IF v_version IS NULL THEN
    INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (p_plan_id, 'budget', btrim(p_name)) RETURNING id INTO v_version;
    INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_version, 'Base', true) RETURNING id INTO v_scenario;
  ELSE
    SELECT s.id INTO v_scenario FROM fpa.scenarios s WHERE s.version_id = v_version AND s.is_base;
    IF NOT FOUND THEN
      INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_version, 'Base', true) RETURNING id INTO v_scenario;
    END IF;
    DELETE FROM fpa.plan_lines l
     WHERE l.scenario_id = v_scenario AND l.period >= p_budget_from AND l.period < (p_budget_from + interval '12 months')::date;
  END IF;

  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin)
  WITH win AS (
    SELECT gs::date AS p, (row_number() OVER (ORDER BY gs) - 1)::integer AS k
      FROM generate_series(p_actuals_from::timestamp, (p_actuals_from + interval '11 months')::timestamp, interval '1 month') AS gs),
  sums AS MATERIALIZED (   -- the window's mapped actuals, read once, summed per line and month
    SELECT m.plan_line AS line, a.period AS p, sum(a.amount) AS amt
      FROM fpa.actuals_monthly a
      JOIN fpa.line_map m ON m.connection_id = a.connection_id AND m.account_code = a.account_code
     WHERE a.entity_id = v_entity AND a.period >= p_actuals_from AND a.period < (p_actuals_from + interval '12 months')::date
     GROUP BY 1, 2),
  exact AS (
    SELECT d.key AS line, w.k,
           coalesce(s.amt, 0) * (1 + coalesce(btrim(v_uplifts ->> d.key)::numeric, 0) / 100) AS amt
      FROM fpa.plan_line_defs d CROSS JOIN win w
      LEFT JOIN sums s ON s.line = d.key AND s.p = w.p
     WHERE d.budgetable),
  rounded AS (
    SELECT e.line, e.k,
           CASE WHEN e.k < 11 THEN round(e.amt, 2)
                ELSE round(sum(e.amt) OVER (PARTITION BY e.line), 2)
                     - (sum(round(e.amt, 2)) OVER (PARTITION BY e.line) - round(e.amt, 2)) END AS amt
      FROM exact e)
  SELECT v_version, v_scenario, r.line, (p_budget_from + make_interval(months => r.k))::date, r.amt, 'from_actuals'
    FROM rounded r ORDER BY r.line, r.k;
  RETURN v_version;
END $$;

-- ── Row security ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE fpa.plan_line_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.sync_runs ENABLE ROW LEVEL SECURITY;
-- The plan-line list is the same for everyone: any signed-in user may read it.
CREATE POLICY plan_line_defs_read ON fpa.plan_line_defs FOR SELECT TO authenticated USING (true);
CREATE POLICY sync_runs_read ON fpa.sync_runs FOR SELECT TO authenticated USING (fpa.is_entity_member(entity_id, 'viewer'));

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON fpa.plan_line_defs, fpa.sync_runs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON fpa.plan_line_defs, fpa.sync_runs TO authenticated;
REVOKE ALL ON FUNCTION fpa.import_actuals(uuid, uuid, jsonb, text), fpa.set_line_map(uuid, jsonb), fpa.account_map(uuid),
                       fpa.unmapped_accounts(uuid), fpa.variance(uuid, uuid, date, date),
                       fpa.create_budget_from_actuals(uuid, uuid, text, date, date, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION fpa.import_actuals(uuid, uuid, jsonb, text), fpa.set_line_map(uuid, jsonb), fpa.account_map(uuid),
                          fpa.unmapped_accounts(uuid), fpa.variance(uuid, uuid, date, date),
                          fpa.create_budget_from_actuals(uuid, uuid, text, date, date, jsonb)
  TO authenticated;
REVOKE ALL ON FUNCTION fpa.my_entity_ids(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION fpa.my_entity_ids(text) TO authenticated;
