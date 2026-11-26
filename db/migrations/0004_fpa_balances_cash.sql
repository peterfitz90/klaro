-- 0004: Klaro Phase 2A. Balances, cash position and the all-or-nothing budget save.
-- Applied only with Peter's approval, as plain SQL in one transaction (db/out/apply_0004.sql, built by
-- db/bundle.mjs), which also records this file and its checksum in fpa.schema_migrations and runs
-- db/apply_checks_0004.sql before COMMIT. Not through Supabase's migration feature, so Supabase's own
-- migration history is unchanged. Touches nothing outside the fpa schema.
--
-- What it adds (Peter's Phase 2 decisions, 25 Nov 2026; docs/reports/P2-0.md)
--   plan_line_defs  a mappable line "Cash and bank" (kind 'balance'), outside the P&L: not budgetable,
--                   never in a profit line, in Compare or in the excluded total.
--   fpa.balances_monthly  closing (month-end) balances per account and month, trial-balance sign.
--   sync_runs.kind  'actuals' (the default: import_actuals is unchanged) or 'balances'.
--   Functions:
--     import_balances    SECURITY DEFINER (the API cannot write balances): editor or owner; replaces
--                        whole months of balances for one connection, in one transaction; logs a
--                        sync_runs row of kind 'balances'. Leaves the connection row alone.
--     balance_accounts   SECURITY INVOKER: every account with balances, unmapped first (for mapping).
--     cash_position      SECURITY INVOKER: the inputs for Cash balance, net cash burn and Runway (the
--                        latest month with balances and the cash at it and the four month-ends before
--                        it). Burn and runway are calculated in src/engine, not here.
--     save_budget_lines  SECURITY INVOKER: saves a set of hand edits to one budget version in one
--                        transaction, or none of them.
--   fpa.variance is replaced with the same text except that 'balance' lines are left out, as
--   'excluded' lines already were (so Cash and bank never shows on Compare).
-- Sign convention: balances are stored trial-balance style (debits positive). plan_line_defs.display_sign
-- turns them into screen figures: Cash and bank has display sign +1, so money in the bank shows positive.

-- ── The plan-line list gains "Cash and bank" ─────────────────────────────────────────────────
ALTER TABLE fpa.plan_line_defs DROP CONSTRAINT plan_line_defs_kind_check;
ALTER TABLE fpa.plan_line_defs ADD CONSTRAINT plan_line_defs_kind_check
  CHECK (kind IN ('income', 'cost', 'calculated', 'unmapped', 'excluded', 'balance'));
-- PostgreSQL 17 changes a generated column in place; the composite foreign keys on (key, mappable) stay.
ALTER TABLE fpa.plan_line_defs ALTER COLUMN mappable SET EXPRESSION AS (kind IN ('income', 'cost', 'excluded', 'balance'));
INSERT INTO fpa.plan_line_defs (key, label, kind, sort_order, display_sign) VALUES
  ('cash_bank', 'Cash and bank', 'balance', 140, 1);

-- ── Balances ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE fpa.balances_monthly (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL,
  connection_id   uuid NOT NULL,
  account_code    text NOT NULL CHECK (length(account_code) BETWEEN 1 AND 64),
  account_name    text CHECK (length(account_name) BETWEEN 1 AND 200),
  period          date NOT NULL CHECK (period = date_trunc('month', period)::date),
  closing_balance numeric(14,2) NOT NULL,   -- month-end balance, trial-balance sign
  synced_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, account_code, period),
  -- The row's entity is the connection's entity: no mixing entities through a connection.
  FOREIGN KEY (connection_id, entity_id) REFERENCES fpa.connections (id, entity_id)
);
CREATE INDEX balances_monthly_entity_period ON fpa.balances_monthly (entity_id, period);
CREATE INDEX balances_monthly_connection_period ON fpa.balances_monthly (connection_id, period);
CREATE TRIGGER balances_monthly_updated_at BEFORE UPDATE ON fpa.balances_monthly FOR EACH ROW EXECUTE FUNCTION fpa.touch_updated_at();

-- ── The sync log tells actuals and balances apart ────────────────────────────────────────────
ALTER TABLE fpa.sync_runs ADD COLUMN kind text NOT NULL DEFAULT 'actuals' CHECK (kind IN ('actuals', 'balances'));
CREATE INDEX sync_runs_connection_kind ON fpa.sync_runs (connection_id, kind, created_at DESC);

-- ── import_balances ──────────────────────────────────────────────────────────────────────────
-- Imports month-end balances for one CSV connection. p_rows is a JSON array of
--   {"account_code": "1200", "account_name": "Bank current account" (optional), "month": "2025-01-01",
--    "amount": "12000.50"}   (the closing balance, as a string or a number; trial-balance sign).
-- The same checks as import_actuals. Every month present in the file is replaced completely for that
-- connection (an account with no row in an imported month therefore has no balance that month); a
-- sync_runs row of kind 'balances' is written. The connection row is not changed (its actuals_through
-- and last_synced_at stay about the P&L). One transaction: any error undoes all of it. Limits: 20,000
-- rows and 5 MB of row data per import.
CREATE FUNCTION fpa.import_balances(p_entity_id uuid, p_connection_id uuid, p_rows jsonb, p_source_name text)
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
    RAISE EXCEPTION 'You need editor or owner access to this entity to import balances.' USING ERRCODE = 'PT403';
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
        THEN 'the balance must be a number with at most two decimals and 12 digits before the point.'
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

  DELETE FROM fpa.balances_monthly b WHERE b.connection_id = p_connection_id AND b.period = ANY (v_months);
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  INSERT INTO fpa.balances_monthly (entity_id, connection_id, account_code, account_name, period, closing_balance)
  SELECT p_entity_id, p_connection_id, btrim(t.elem ->> 'account_code'), nullif(btrim(t.elem ->> 'account_name'), ''),
         (t.elem ->> 'month')::date, btrim(t.elem ->> 'amount')::numeric
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS t(elem, n) ORDER BY t.n;
  GET DIAGNOSTICS v_added = ROW_COUNT;

  SELECT max(b.period) INTO v_through FROM fpa.balances_monthly b WHERE b.connection_id = p_connection_id;
  INSERT INTO fpa.sync_runs (entity_id, connection_id, run_by, source_name, months_replaced, rows_removed, rows_added, status, kind)
  VALUES (p_entity_id, p_connection_id, v_sub, v_source, v_months, v_removed, v_added, 'succeeded', 'balances') RETURNING id INTO v_run;

  RETURN jsonb_build_object('sync_run_id', v_run, 'months_replaced', to_jsonb(v_months), 'rows_removed', v_removed,
                            'rows_added', v_added, 'balances_through', v_through, 'imported_at', now());
END $$;

-- ── Balance accounts (for the mapping screen) ────────────────────────────────────────────────
-- Every account of the entity that has balances, with its mapping (if any), the number of months
-- and the latest closing balance (trial-balance sign). Unmapped accounts first, then account code,
-- then connection: a fixed order, so the screen can read it a page at a time. Runs as the caller: a
-- non-member gets no rows.
CREATE FUNCTION fpa.balance_accounts(p_entity_id uuid)
RETURNS TABLE (connection_id uuid, account_code text, account_name text, plan_line text, months integer,
               first_month date, last_month date, last_balance numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = fpa, pg_temp AS $$
  WITH bal AS (
    SELECT b.connection_id AS conn, b.account_code AS code,
           (array_agg(b.account_name ORDER BY b.period DESC) FILTER (WHERE b.account_name IS NOT NULL))[1] AS name,
           count(*)::integer AS n, min(b.period) AS first_p, max(b.period) AS last_p,
           (array_agg(b.closing_balance ORDER BY b.period DESC))[1] AS last_bal
      FROM fpa.balances_monthly b WHERE b.entity_id = p_entity_id
     GROUP BY b.connection_id, b.account_code)
  SELECT x.conn, x.code, x.name, m.plan_line, x.n, x.first_p, x.last_p, x.last_bal
    FROM bal x LEFT JOIN fpa.line_map m ON m.connection_id = x.conn AND m.account_code = x.code
   ORDER BY (m.plan_line IS NOT NULL), x.code, x.conn;
$$;

-- ── Cash position (the inputs for Cash balance, net cash burn and Runway) ─────────────────────
-- For the entity's latest month with balances (any account), and the four month-ends before it,
-- one row each (five rows, newest first; none at all if the entity has no balances):
--   month          the month-end;
--   has_balances   whether any balances were imported for that month;
--   cash           the sum of the closing balances of accounts mapped to Cash and bank, in display
--                  sign (positive money in the bank); 0 if the month has balances but no cash account
--                  row; NULL if the month has no balances at all (never imported: not zero);
-- and on every row: latest_month, months_available (distinct months with balances),
-- unmapped_accounts (accounts with balances in the latest month and no mapping) and cash_accounts
-- (accounts mapped to Cash and bank with a balance row in the latest month: 0 means "not set up",
-- which the screen must tell apart from cash that is truly zero). Runs as the caller: row security
-- applies, so a non-member gets no rows. Burn and runway are worked out in src/engine.
CREATE FUNCTION fpa.cash_position(p_entity_id uuid)
RETURNS TABLE (latest_month date, months_available integer, unmapped_accounts integer, cash_accounts integer,
               month date, has_balances boolean, cash numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = fpa, pg_temp AS $$
  WITH bal AS MATERIALIZED (
    SELECT b.connection_id, b.account_code, b.period, b.closing_balance
      FROM fpa.balances_monthly b WHERE b.entity_id = p_entity_id),
  head AS (
    SELECT max(x.period) AS latest, count(DISTINCT x.period)::integer AS n FROM bal x),
  unm AS (
    SELECT count(*)::integer AS n FROM bal x, head h
     WHERE x.period = h.latest
       AND NOT EXISTS (SELECT 1 FROM fpa.line_map m WHERE m.connection_id = x.connection_id AND m.account_code = x.account_code)),
  cash_n AS (
    SELECT count(*)::integer AS n FROM bal x, head h
     WHERE x.period = h.latest
       AND EXISTS (SELECT 1 FROM fpa.line_map m WHERE m.connection_id = x.connection_id AND m.account_code = x.account_code
                     AND m.plan_line = 'cash_bank')),
  mon AS (
    SELECT (h.latest - make_interval(months => k))::date AS p FROM head h, generate_series(0, 4) AS k WHERE h.latest IS NOT NULL),
  months_with AS (SELECT DISTINCT x.period AS p FROM bal x),
  cash AS (
    SELECT x.period AS p, sum(x.closing_balance) * d.display_sign AS amt
      FROM bal x
      JOIN fpa.line_map m ON m.connection_id = x.connection_id AND m.account_code = x.account_code
      JOIN fpa.plan_line_defs d ON d.key = m.plan_line AND d.key = 'cash_bank'
     GROUP BY x.period, d.display_sign)
  SELECT h.latest, h.n, u.n, cn.n, mo.p, (w.p IS NOT NULL),
         CASE WHEN w.p IS NULL THEN NULL ELSE coalesce(c.amt, 0) END
    FROM mon mo CROSS JOIN head h CROSS JOIN unm u CROSS JOIN cash_n cn
    LEFT JOIN months_with w ON w.p = mo.p
    LEFT JOIN cash c ON c.p = mo.p
   ORDER BY mo.p DESC;
$$;

-- ── All-or-nothing budget save ───────────────────────────────────────────────────────────────
-- Saves a set of hand edits to one budget version: p_lines is a JSON array of
--   {"id": "<plan_lines id>", "amount": "-1500.00"}   (stored trial-balance sign, as the screen sends).
-- Every line must be a stored budget line (not an 'actual' line) of the version's base scenario, with
-- no line twice; 1 to 1,200 lines. Each line's amount is set and its origin becomes 'manual'. Editor
-- or owner; refused if the version is locked (PT423). Runs as the caller (row security and the lock
-- triggers apply). One transaction: either every line is saved or none is. Returns the count.
CREATE FUNCTION fpa.save_budget_lines(p_version_id uuid, p_lines jsonb)
RETURNS integer LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = fpa, pg_temp AS $$
DECLARE
  v_locked timestamptz;
  v_kind text;
  v_bad text;
  v_n integer;
BEGIN
  IF p_version_id IS NULL OR NOT fpa.member_for_version(p_version_id, 'editor') THEN
    RAISE EXCEPTION 'You need editor or owner access to this budget.' USING ERRCODE = 'PT403';
  END IF;
  SELECT v.locked_at, v.kind INTO v_locked, v_kind FROM fpa.plan_versions v WHERE v.id = p_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That version was not found.' USING ERRCODE = 'PT404'; END IF;
  IF v_kind <> 'budget' THEN RAISE EXCEPTION 'That version is not a budget.' USING ERRCODE = 'PT400'; END IF;
  IF v_locked IS NOT NULL THEN RAISE EXCEPTION 'This version is locked. Unlock it first.' USING ERRCODE = 'PT423'; END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) NOT BETWEEN 1 AND 1200 THEN
    RAISE EXCEPTION 'Send a list of 1 to 1,200 lines.' USING ERRCODE = 'PT400';
  END IF;

  SELECT format('Line %s: %s', r.n, r.problem) INTO v_bad FROM (
    SELECT t.n, CASE
      WHEN jsonb_typeof(t.elem) <> 'object' THEN 'each line must be an object.'
      WHEN EXISTS (SELECT 1 FROM jsonb_object_keys(t.elem) k(key) WHERE k.key NOT IN ('id', 'amount'))
        THEN 'only id and amount are allowed.'
      WHEN jsonb_typeof(t.elem -> 'id') IS DISTINCT FROM 'string'
           OR (t.elem ->> 'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN 'the id must be a line id.'
      WHEN coalesce(jsonb_typeof(t.elem -> 'amount'), 'null') NOT IN ('string', 'number')
           OR btrim(t.elem ->> 'amount') !~ '^-?\d{1,12}(\.\d{1,2})?$'
        THEN 'the amount must be a number with at most two decimals and 12 digits before the point.'
      WHEN NOT EXISTS (SELECT 1 FROM fpa.plan_lines l JOIN fpa.scenarios s ON s.id = l.scenario_id AND s.is_base
                        WHERE l.id = (t.elem ->> 'id')::uuid AND l.version_id = p_version_id AND l.origin <> 'actual')
        THEN 'that line is not a budget line of this version.'
    END AS problem
    FROM jsonb_array_elements(p_lines) WITH ORDINALITY AS t(elem, n)
  ) r WHERE r.problem IS NOT NULL ORDER BY r.n LIMIT 1;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '%', v_bad USING ERRCODE = 'PT400'; END IF;
  SELECT format('Line %s is listed more than once.', d.id) INTO v_bad FROM (
    SELECT lower(t.elem ->> 'id') AS id FROM jsonb_array_elements(p_lines) AS t(elem) GROUP BY 1 HAVING count(*) > 1 ORDER BY 1 LIMIT 1) d;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION '%', v_bad USING ERRCODE = 'PT400'; END IF;

  UPDATE fpa.plan_lines l SET amount = btrim(t.elem ->> 'amount')::numeric, origin = 'manual'
    FROM jsonb_array_elements(p_lines) AS t(elem)
   WHERE l.id = (t.elem ->> 'id')::uuid AND l.version_id = p_version_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> jsonb_array_length(p_lines) THEN
    RAISE EXCEPTION 'Only % of % lines could be saved; nothing was saved.', v_n, jsonb_array_length(p_lines) USING ERRCODE = 'PT409';
  END IF;
  RETURN v_n;
END $$;

-- ── Variance leaves balance lines out ────────────────────────────────────────────────────────
-- The 0003 function, unchanged except "d.kind <> 'excluded'" becomes "d.kind NOT IN ('excluded',
-- 'balance')" (db/bundle.mjs checks that this is the only difference). Its privileges are kept.
CREATE OR REPLACE FUNCTION fpa.variance(p_entity_id uuid, p_version_id uuid, p_from date, p_to date)
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
     WHERE d.kind NOT IN ('excluded', 'balance'))
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

-- ── Row security ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE fpa.balances_monthly ENABLE ROW LEVEL SECURITY;
-- The same rule as actuals: an active member, viewer or above, worked out once per query.
CREATE POLICY balances_monthly_read ON fpa.balances_monthly FOR SELECT TO authenticated
  USING (entity_id = ANY (ARRAY(SELECT fpa.my_entity_ids('viewer'))));

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON fpa.balances_monthly FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON fpa.balances_monthly TO authenticated;
REVOKE ALL ON FUNCTION fpa.import_balances(uuid, uuid, jsonb, text), fpa.balance_accounts(uuid), fpa.cash_position(uuid),
                       fpa.save_budget_lines(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION fpa.import_balances(uuid, uuid, jsonb, text), fpa.balance_accounts(uuid), fpa.cash_position(uuid),
                          fpa.save_budget_lines(uuid, jsonb)
  TO authenticated;
