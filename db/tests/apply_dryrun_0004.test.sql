-- Rolled-back dry run of db/out/apply_0004.sql. db/bundle.mjs puts this after everything in the apply
-- file except its COMMIT: 0004, its fpa.schema_migrations row and db/apply_checks_0004.sql (which has
-- already passed by the time this runs). It then shows the checks fail closed (each fault below must
-- make them raise), runs plpgsql_check over every PL/pgSQL function in fpa, and ends by raising its
-- result, so everything rolls back. Expect "0 failure(s), 15 pass(es)" and 0 plpgsql_check findings.
CREATE EXTENSION IF NOT EXISTS plpgsql_check;
DO $dry$
DECLARE
  v_checks constant text := $chk$__APPLY_CHECKS_0004__$chk$;
  v_f text[] := '{}'; v_p int := 0; v_case text; v_fns int; v_n int; v_issues text;
BEGIN
  BEGIN EXECUTE v_checks; v_p := v_p + 1;
  EXCEPTION WHEN raise_exception THEN v_f := v_f || ('checks failed on the applied state: ' || SQLERRM); END;

  -- Each fault must make the checks refuse. Every case runs in its own subtransaction and is undone.
  FOREACH v_case IN ARRAY ARRAY[
      'GRANT SELECT ON fpa.balances_monthly TO anon',
      'GRANT INSERT ON fpa.balances_monthly TO authenticated',
      'GRANT EXECUTE ON FUNCTION fpa.import_balances(uuid, uuid, jsonb, text) TO anon',
      'GRANT EXECUTE ON FUNCTION fpa.cash_position(uuid) TO service_role',
      'REVOKE EXECUTE ON FUNCTION fpa.save_budget_lines(uuid, jsonb) FROM authenticated',
      'ALTER FUNCTION fpa.cash_position(uuid) SECURITY DEFINER',
      'ALTER FUNCTION fpa.import_balances(uuid, uuid, jsonb, text) SECURITY INVOKER',
      'CREATE POLICY balances_extra ON fpa.balances_monthly FOR SELECT TO authenticated USING (true)',
      'ALTER POLICY balances_monthly_read ON fpa.balances_monthly USING (true)',
      'UPDATE fpa.plan_line_defs SET display_sign = -1 WHERE key = ''cash_bank''',
      'UPDATE fpa.schema_migrations SET checksum = repeat(''0'', 64) WHERE filename LIKE ''0004%''',
      'ALTER TABLE fpa.sync_runs ALTER COLUMN kind DROP DEFAULT',
      'CREATE OR REPLACE FUNCTION fpa.account_map(p_entity_id uuid) RETURNS TABLE (connection_id uuid, account_code text, account_name text, plan_line text, months integer, first_month date, last_month date, total numeric) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = fpa, pg_temp AS $f$ SELECT NULL::uuid, NULL::text, NULL::text, NULL::text, 0, NULL::date, NULL::date, 0::numeric WHERE false $f$',
      'INSERT INTO fpa.vat_rules (jurisdiction, rate_code, rate, effective_from) VALUES (''IE'', ''STD'', 23, ''2025-01-01'')'] LOOP
    BEGIN
      EXECUTE v_case;
      EXECUTE v_checks;
      v_f := v_f || ('checks passed despite: ' || v_case);
      RAISE EXCEPTION 'undo' USING ERRCODE = 'P0099';
    EXCEPTION
      WHEN SQLSTATE 'P0099' THEN NULL;
      WHEN raise_exception THEN
        IF SQLERRM LIKE 'Apply check failed%' THEN v_p := v_p + 1; ELSE v_f := v_f || (v_case || ': ' || SQLERRM); END IF;
    END;
  END LOOP;

  -- plpgsql_check over every PL/pgSQL function in the schema (0001's, 0003's and 0004's). Each trigger
  -- function is checked against a table it is attached to.
  SELECT count(DISTINCT x.fn), count(*) FILTER (WHERE r.level IS NOT NULL),
         string_agg(format('%s [%s]: %s %s', x.fn::regproc, x.rel, r.level, r.message), ' | ') FILTER (WHERE r.level IS NOT NULL)
    INTO v_fns, v_n, v_issues
    FROM (SELECT p.oid AS fn, rel FROM pg_proc p,
                 unnest(CASE WHEN p.prorettype <> 'trigger'::regtype THEN ARRAY[0::regclass]
                             WHEN p.proname = 'guard_locked_version' THEN ARRAY['fpa.plan_versions'::regclass]
                             WHEN p.proname = 'guard_locked_child' THEN ARRAY['fpa.plan_lines'::regclass, 'fpa.scenarios'::regclass, 'fpa.packs'::regclass]
                             WHEN p.proname IN ('guard_locked_driver_value', 'check_driver_value_plan') THEN ARRAY['fpa.driver_values'::regclass]
                             ELSE ARRAY['fpa.entities'::regclass] END) rel
           WHERE p.pronamespace = 'fpa'::regnamespace AND p.prolang = (SELECT l.oid FROM pg_language l WHERE l.lanname = 'plpgsql')) x
    LEFT JOIN LATERAL plpgsql_check_function_tb(x.fn, x.rel) r ON true;

  RAISE EXCEPTION E'% failure(s), % pass(es)%\nplpgsql_check: % PL/pgSQL functions checked, % finding(s)%',
    coalesce(array_length(v_f, 1), 0), v_p, CASE WHEN array_length(v_f, 1) > 0 THEN E'\nFAILED: ' || array_to_string(v_f, ' | ') ELSE '' END,
    v_fns, v_n, CASE WHEN v_n > 0 THEN E'\n' || v_issues ELSE '' END;
END $dry$;
