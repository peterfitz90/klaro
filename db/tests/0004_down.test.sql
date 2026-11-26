-- Rolled-back test of db/rollback/0004_down.sql. Runs after 0004 and its fpa.schema_migrations row
-- inside one transaction (db/bundle.mjs builds db/out/test_down_0004.sql, puts the rollback script in
-- v_down, the 0003 apply checks in v_checks_0003 and the 0003 variance body hash in v_variance_md5).
-- Ends by raising its result, so everything rolls back. Expect "0 failure(s), 8 pass(es)".
DO $t$
DECLARE
  v_f text[] := '{}'; v_p int := 0;
  v_down constant text := $down_text$__DOWN_SQL__$down_text$;
  v_checks_0003 constant text := $chk$__APPLY_CHECKS_0003__$chk$;
  v_variance_md5 constant text := '__MD5_VARIANCE_0003__';
  v_e uuid; v_c uuid; v_n_actuals bigint; v_n_lines bigint;
BEGIN
  -- Data the guards must notice: a balance, a balance import record, a Cash and bank mapping.
  INSERT INTO fpa.entities (name, jurisdiction, currency) VALUES ('Down Test Ltd', 'IE', 'EUR') RETURNING id INTO v_e;
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_e, 'csv') RETURNING id INTO v_c;
  INSERT INTO fpa.balances_monthly (entity_id, connection_id, account_code, period, closing_balance) VALUES (v_e, v_c, '1200', '2025-01-01', 100);
  INSERT INTO fpa.sync_runs (entity_id, connection_id, run_by, source_name, months_replaced, rows_removed, rows_added, status, kind)
  VALUES (v_e, v_c, 'user_downtest', 'balances.csv', '{2025-01-01}', 0, 1, 'succeeded', 'balances');
  INSERT INTO fpa.sync_runs (entity_id, connection_id, run_by, source_name, months_replaced, rows_removed, rows_added, status)
  VALUES (v_e, v_c, 'user_downtest', 'pl.csv', '{2025-01-01}', 0, 1, 'succeeded');
  INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, period, amount) VALUES (v_e, v_c, '4000', '2025-01-01', -1);
  INSERT INTO fpa.line_map (connection_id, account_code, plan_line) VALUES (v_c, '1200', 'cash_bank'), (v_c, '4000', 'revenue');
  SELECT count(*) INTO v_n_actuals FROM fpa.actuals_monthly;
  SELECT count(*) INTO v_n_lines FROM fpa.plan_lines;

  -- 1. Without the confirmation it refuses and changes nothing.
  BEGIN EXECUTE v_down; v_f := v_f || 'ran without confirmation'::text;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Refusing to roll back 0004%' THEN v_p := v_p + 1; ELSE v_f := v_f || SQLERRM; END IF; END;
  IF to_regclass('fpa.balances_monthly') IS NOT NULL THEN v_p := v_p + 1; ELSE v_f := v_f || 'changed after a refusal'::text; END IF;

  -- 2. Confirmed, but balances and a Cash and bank mapping exist: refuses without the data confirmation.
  PERFORM set_config('fpa.confirm_down_0004', 'yes, remove 0004', true);
  BEGIN EXECUTE v_down; v_f := v_f || 'ran with balances present and no data confirmation'::text;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Refusing: balances, balance import records or Cash and bank mappings%' THEN v_p := v_p + 1; ELSE v_f := v_f || SQLERRM; END IF; END;

  -- 3. Both set: rolled back. The schema is exactly as after 0003: the 0003 apply checks pass again
  --    (17 to 16 tables, 43 to 42 policies, 31 to 27 functions, the 13-line list, 0001 and 0003 only).
  PERFORM set_config('fpa.confirm_down_0004_with_data', 'yes', true);
  EXECUTE v_down;
  IF to_regclass('fpa.balances_monthly') IS NULL AND to_regprocedure('fpa.import_balances(uuid, uuid, jsonb, text)') IS NULL
     AND to_regprocedure('fpa.cash_position(uuid)') IS NULL AND to_regprocedure('fpa.balance_accounts(uuid)') IS NULL
     AND to_regprocedure('fpa.save_budget_lines(uuid, jsonb)') IS NULL THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'a 0004 object is still there'::text; END IF;
  BEGIN EXECUTE v_checks_0003; v_p := v_p + 1;
  EXCEPTION WHEN raise_exception THEN v_f := v_f || ('0003 apply checks fail after the rollback: ' || SQLERRM); END;
  -- variance is back to its exact 0003 text, with its privileges.
  IF (SELECT md5(p.prosrc) FROM pg_proc p WHERE p.oid = 'fpa.variance(uuid, uuid, date, date)'::regprocedure) = v_variance_md5
     AND has_function_privilege('authenticated', 'fpa.variance(uuid, uuid, date, date)', 'EXECUTE')
     AND NOT has_function_privilege('anon', 'fpa.variance(uuid, uuid, date, date)', 'EXECUTE') THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'variance is not the exact 0003 text, or its privileges changed'::text; END IF;
  -- The mappable expression and kind check are as 0003 left them.
  IF (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
       WHERE d.adrelid = 'fpa.plan_line_defs'::regclass AND a.attname = 'mappable')
       = '(kind = ANY (ARRAY[''income''::text, ''cost''::text, ''excluded''::text]))'
     AND pg_get_constraintdef((SELECT k.oid FROM pg_constraint k WHERE k.conname = 'plan_line_defs_kind_check' AND k.connamespace = 'fpa'::regnamespace))
       = 'CHECK ((kind = ANY (ARRAY[''income''::text, ''cost''::text, ''calculated''::text, ''unmapped''::text, ''excluded''::text])))' THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'the mappable expression or the kind check is not the 0003 one'::text; END IF;
  -- The balance data and Cash and bank mapping are gone; the P&L data, the actuals sync record and the
  -- other mapping stay; nothing outside fpa changed.
  IF NOT EXISTS (SELECT 1 FROM fpa.line_map m WHERE m.plan_line = 'cash_bank') AND EXISTS (SELECT 1 FROM fpa.line_map m WHERE m.connection_id = v_c AND m.plan_line = 'revenue')
     AND (SELECT count(*) FROM fpa.sync_runs s WHERE s.entity_id = v_e) = 1
     AND (SELECT count(*) FROM fpa.actuals_monthly) = v_n_actuals AND (SELECT count(*) FROM fpa.plan_lines) = v_n_lines
     AND to_regclass('public.journals') IS NOT NULL THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'data was lost that should stay, or something outside fpa changed'::text; END IF;

  RAISE EXCEPTION '% failure(s), % pass(es) %', coalesce(array_length(v_f, 1), 0), v_p, array_to_string(v_f, ' | ');
END $t$;
