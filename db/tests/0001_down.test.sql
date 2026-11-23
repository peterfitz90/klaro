-- Rolled-back test of db/rollback/0001_down.sql. Runs after 0001 inside one transaction (db/bundle.mjs
-- builds db/out/test_down.sql and puts the rollback script in v_down). Ends by raising its result, so
-- everything rolls back. Expect "0 failure(s), 5 pass(es)".
DO $t$
DECLARE v_f text[] := '{}'; v_p int := 0; v_down constant text := $down_text$__DOWN_SQL__$down_text$;
BEGIN
  -- An entity exists, so the second guard matters too.
  INSERT INTO fpa.entities (name, jurisdiction, currency) VALUES ('Down Test Ltd', 'IE', 'EUR');

  -- 1. Without the confirmation it refuses and changes nothing.
  BEGIN EXECUTE v_down; v_f := v_f || 'ran without confirmation'::text;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Refusing to remove%' THEN v_p := v_p + 1; ELSE v_f := v_f || SQLERRM; END IF; END;
  IF to_regnamespace('fpa') IS NOT NULL THEN v_p := v_p + 1; ELSE v_f := v_f || 'schema gone after a refusal'::text; END IF;

  -- 2. Confirmed, but entities exist and the data guard is not set: refuses.
  PERFORM set_config('fpa.confirm_down', 'yes, remove the fpa schema', true);
  BEGIN EXECUTE v_down; v_f := v_f || 'ran with entities present and no data confirmation'::text;
  EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Refusing: the fpa schema holds entities%' THEN v_p := v_p + 1; ELSE v_f := v_f || SQLERRM; END IF; END;

  -- 3. Both set: the schema is removed; nothing outside it is.
  PERFORM set_config('fpa.confirm_down_with_data', 'yes', true);
  EXECUTE v_down;
  IF to_regnamespace('fpa') IS NULL THEN v_p := v_p + 1; ELSE v_f := v_f || 'schema still there'::text; END IF;
  IF to_regclass('public.journals') IS NOT NULL AND to_regclass('booking.venues') IS NOT NULL THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'something outside the fpa schema changed'::text; END IF;

  RAISE EXCEPTION '% failure(s), % pass(es) %', coalesce(array_length(v_f, 1), 0), v_p, array_to_string(v_f, ' | ');
END $t$;
