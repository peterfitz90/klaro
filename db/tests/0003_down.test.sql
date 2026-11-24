-- Rolled-back test of db/rollback/0003_down.sql. Runs after 0003 and its fpa.schema_migrations row
-- inside one transaction (db/bundle.mjs builds db/out/test_down_0003.sql, puts the rollback script in
-- v_down and the 0001 apply checks in v_checks_0001). Ends by raising its result, so everything rolls
-- back. Expect "0 failure(s), 9 pass(es)".
DO $t$
DECLARE
  v_f text[] := '{}'; v_p int := 0;
  v_down constant text := $down_text$__DOWN_SQL__$down_text$;
  v_checks_0001 constant text := $chk$__APPLY_CHECKS_0001__$chk$;
  v_origin_before text; v_e uuid; v_c uuid; v_pl uuid; v_v uuid; v_s uuid;
BEGIN
  -- Data that the guards must notice: a sync log row, an account name, a budget line from actuals.
  INSERT INTO fpa.entities (name, jurisdiction, currency) VALUES ('Down Test Ltd', 'IE', 'EUR') RETURNING id INTO v_e;
  INSERT INTO fpa.connections (entity_id, source_type) VALUES (v_e, 'csv') RETURNING id INTO v_c;
  INSERT INTO fpa.actuals_monthly (entity_id, connection_id, account_code, account_name, period, amount) VALUES (v_e, v_c, '4000', 'Sales', '2025-01-01', -1);
  INSERT INTO fpa.sync_runs (entity_id, connection_id, run_by, source_name, months_replaced, rows_removed, rows_added, status)
  VALUES (v_e, v_c, 'user_downtest', 'down.csv', '{2025-01-01}', 0, 1, 'succeeded');
  INSERT INTO fpa.plans (entity_id, name) VALUES (v_e, 'Plan') RETURNING id INTO v_pl;
  INSERT INTO fpa.plan_versions (plan_id, kind, name) VALUES (v_pl, 'budget', 'B') RETURNING id INTO v_v;
  INSERT INTO fpa.scenarios (version_id, name, is_base) VALUES (v_v, 'Base', true) RETURNING id INTO v_s;
  INSERT INTO fpa.plan_lines (version_id, scenario_id, plan_line, period, amount, origin) VALUES (v_v, v_s, 'revenue', '2026-01-01', -1, 'from_actuals');

  -- 1. Without the confirmation it refuses and changes nothing.
  BEGIN EXECUTE v_down; v_f := v_f || 'ran without confirmation'::text;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Refusing to roll back 0003%' THEN v_p := v_p + 1; ELSE v_f := v_f || SQLERRM; END IF; END;
  IF to_regclass('fpa.plan_line_defs') IS NOT NULL THEN v_p := v_p + 1; ELSE v_f := v_f || 'changed after a refusal'::text; END IF;

  -- 2. Confirmed, but a budget line from actuals exists: refuses.
  PERFORM set_config('fpa.confirm_down_0003', 'yes, remove 0003', true);
  BEGIN EXECUTE v_down; v_f := v_f || 'ran with from_actuals lines present'::text;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Refusing: budget lines made from actuals%' THEN v_p := v_p + 1; ELSE v_f := v_f || SQLERRM; END IF; END;

  -- 3. That line set to manual; the sync log and names still need the data confirmation: refuses.
  UPDATE fpa.plan_lines SET origin = 'manual' WHERE version_id = v_v;
  BEGIN EXECUTE v_down; v_f := v_f || 'ran with a sync log and names present and no data confirmation'::text;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Refusing: the sync log or account names%' THEN v_p := v_p + 1; ELSE v_f := v_f || SQLERRM; END IF; END;

  -- 4. Both set: rolled back. The schema is exactly as after 0001: the 0001 apply checks pass again,
  --    the origin check reads as 0001 created it, and the actuals, plans and lines are still there.
  PERFORM set_config('fpa.confirm_down_0003_with_data', 'yes', true);
  EXECUTE v_down;
  IF to_regclass('fpa.plan_line_defs') IS NULL AND to_regclass('fpa.sync_runs') IS NULL
     AND to_regprocedure('fpa.import_actuals(uuid, uuid, jsonb, text)') IS NULL THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'a 0003 object is still there'::text; END IF;
  BEGIN EXECUTE v_checks_0001; v_p := v_p + 1;
  EXCEPTION WHEN raise_exception THEN v_f := v_f || ('0001 apply checks fail after the rollback: ' || SQLERRM); END;
  SELECT pg_get_constraintdef(k.oid) INTO v_origin_before FROM pg_constraint k WHERE k.conname = 'plan_lines_origin_check' AND k.connamespace = 'fpa'::regnamespace;
  IF v_origin_before = 'CHECK ((origin = ANY (ARRAY[''actual''::text, ''driver''::text, ''manual''::text])))' THEN v_p := v_p + 1;
  ELSE v_f := v_f || ('origin check is ' || coalesce(v_origin_before, 'missing')); END IF;
  IF (SELECT string_agg(p.policyname || '=' || p.qual, ' ; ' ORDER BY p.policyname) FROM pg_policies p
       WHERE p.schemaname = 'fpa' AND p.policyname IN ('actuals_monthly_read', 'line_map_read'))
     = 'actuals_monthly_read=fpa.is_entity_member(entity_id, ''viewer''::text) ; line_map_read=fpa.member_for_connection(connection_id, ''viewer''::text)'
     AND to_regprocedure('fpa.my_entity_ids(text)') IS NULL THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'the Phase 0 read policies are not restored exactly'::text; END IF;
  IF (SELECT count(*) FROM fpa.actuals_monthly a WHERE a.entity_id = v_e) = 1 AND (SELECT count(*) FROM fpa.plan_lines l WHERE l.version_id = v_v) = 1
     AND to_regclass('public.journals') IS NOT NULL THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'data or something outside fpa changed'::text; END IF;

  RAISE EXCEPTION '% failure(s), % pass(es) %', coalesce(array_length(v_f, 1), 0), v_p, array_to_string(v_f, ' | ');
END $t$;
