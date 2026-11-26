-- Rollback for 0004_fpa_balances_cash.sql. NEVER RUN AUTOMATICALLY. Nothing in this repo runs it, and
-- db/bundle.mjs only embeds it in its rolled-back test (db/out/test_down_0004.sql).
--
-- It returns the fpa schema to exactly its state after 0003 (db/apply_checks_0003.sql passes again):
-- removes the four 0004 functions, fpa.balances_monthly (and its policy), sync_runs.kind (and its
-- index), the "Cash and bank" plan line, 'balance' as a plan-line kind and from the mappable
-- expression; restores fpa.variance to its exact 0003 text; and removes the 0004 row in
-- fpa.schema_migrations. Run it inside one transaction. It touches nothing outside the fpa schema.
--
-- Guards, set in the same session before running it:
--   SET fpa.confirm_down_0004 = 'yes, remove 0004';
--   SET fpa.confirm_down_0004_with_data = 'yes';   -- only if balances, balance import records or
--                                                  -- "Cash and bank" mappings exist (they are deleted)
-- Without the guards it refuses and changes nothing.

DO $down$
BEGIN
  IF to_regclass('fpa.balances_monthly') IS NULL THEN
    RAISE NOTICE '0004 is not applied: nothing to roll back.';
    RETURN;
  END IF;
  IF coalesce(current_setting('fpa.confirm_down_0004', true), '') <> 'yes, remove 0004' THEN
    RAISE EXCEPTION 'Refusing to roll back 0004: set fpa.confirm_down_0004 to ''yes, remove 0004'' first';
  END IF;
  IF (EXISTS (SELECT 1 FROM fpa.balances_monthly) OR EXISTS (SELECT 1 FROM fpa.sync_runs s WHERE s.kind = 'balances')
      OR EXISTS (SELECT 1 FROM fpa.line_map m WHERE m.plan_line = 'cash_bank'))
     AND coalesce(current_setting('fpa.confirm_down_0004_with_data', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'Refusing: balances, balance import records or Cash and bank mappings exist and would be deleted. Export them first, then set fpa.confirm_down_0004_with_data to ''yes''';
  END IF;

  EXECUTE 'DROP FUNCTION fpa.save_budget_lines(uuid, jsonb)';
  EXECUTE 'DROP FUNCTION fpa.cash_position(uuid)';
  EXECUTE 'DROP FUNCTION fpa.balance_accounts(uuid)';
  EXECUTE 'DROP FUNCTION fpa.import_balances(uuid, uuid, jsonb, text)';
  -- fpa.variance exactly as 0003 created it (CREATE OR REPLACE keeps its privileges).
  EXECUTE $vsql$CREATE OR REPLACE FUNCTION fpa.variance(p_entity_id uuid, p_version_id uuid, p_from date, p_to date)
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
END $$;$vsql$;
  EXECUTE 'DELETE FROM fpa.sync_runs WHERE kind = ''balances''';
  EXECUTE 'DROP INDEX fpa.sync_runs_connection_kind';
  EXECUTE 'ALTER TABLE fpa.sync_runs DROP COLUMN kind';
  EXECUTE 'DROP TABLE fpa.balances_monthly';
  EXECUTE 'DELETE FROM fpa.line_map WHERE plan_line = ''cash_bank''';
  EXECUTE 'DELETE FROM fpa.plan_line_defs WHERE key = ''cash_bank''';
  EXECUTE 'ALTER TABLE fpa.plan_line_defs ALTER COLUMN mappable SET EXPRESSION AS (kind IN (''income'', ''cost'', ''excluded''))';
  EXECUTE 'ALTER TABLE fpa.plan_line_defs DROP CONSTRAINT plan_line_defs_kind_check';
  EXECUTE 'ALTER TABLE fpa.plan_line_defs ADD CONSTRAINT plan_line_defs_kind_check CHECK (kind IN (''income'', ''cost'', ''calculated'', ''unmapped'', ''excluded''))';
  EXECUTE 'DELETE FROM fpa.schema_migrations WHERE filename = ''0004_fpa_balances_cash.sql''';
  RAISE NOTICE '0004 was rolled back.';
END $down$;
