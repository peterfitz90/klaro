-- Rollback for 0003_fpa_actuals_budget_variance.sql. NEVER RUN AUTOMATICALLY. Nothing in this repo
-- runs it, and db/bundle.mjs only embeds it in its rolled-back test (db/out/test_down_0003.sql).
--
-- It returns the fpa schema to exactly its state after 0001 (db/apply_checks.sql passes again):
-- removes the six Phase 1 functions, fpa.sync_runs, fpa.plan_line_defs, actuals_monthly.account_name,
-- the plan-line foreign keys and their columns, 'from_actuals' as a plan_lines origin, and the 0003
-- row in fpa.schema_migrations. Actuals, line maps and plan lines themselves stay. Run it inside one
-- transaction. It touches nothing outside the fpa schema.
--
-- Guards, set in the same session before running it:
--   SET fpa.confirm_down_0003 = 'yes, remove 0003';
--   SET fpa.confirm_down_0003_with_data = 'yes';   -- only if any sync log or account name exists
-- Budget lines made from actuals (origin 'from_actuals') must be removed or changed to 'manual' first;
-- it refuses while any exist. Without the guards it refuses and changes nothing.

DO $down$
BEGIN
  IF to_regclass('fpa.plan_line_defs') IS NULL THEN
    RAISE NOTICE '0003 is not applied: nothing to roll back.';
    RETURN;
  END IF;
  IF coalesce(current_setting('fpa.confirm_down_0003', true), '') <> 'yes, remove 0003' THEN
    RAISE EXCEPTION 'Refusing to roll back 0003: set fpa.confirm_down_0003 to ''yes, remove 0003'' first';
  END IF;
  IF EXISTS (SELECT 1 FROM fpa.plan_lines l WHERE l.origin = 'from_actuals') THEN
    RAISE EXCEPTION 'Refusing: budget lines made from actuals exist (origin from_actuals). Remove them or set them to manual first';
  END IF;
  IF (EXISTS (SELECT 1 FROM fpa.sync_runs) OR EXISTS (SELECT 1 FROM fpa.actuals_monthly a WHERE a.account_name IS NOT NULL))
     AND coalesce(current_setting('fpa.confirm_down_0003_with_data', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'Refusing: the sync log or account names hold data that would be lost. Export them first, then set fpa.confirm_down_0003_with_data to ''yes''';
  END IF;

  EXECUTE 'DROP FUNCTION fpa.create_budget_from_actuals(uuid, uuid, text, date, date, jsonb)';
  EXECUTE 'DROP FUNCTION fpa.variance(uuid, uuid, date, date)';
  EXECUTE 'DROP FUNCTION fpa.unmapped_accounts(uuid)';
  EXECUTE 'DROP FUNCTION fpa.account_map(uuid)';
  EXECUTE 'DROP FUNCTION fpa.set_line_map(uuid, jsonb)';
  EXECUTE 'DROP FUNCTION fpa.import_actuals(uuid, uuid, jsonb, text)';
  EXECUTE 'DROP TABLE fpa.sync_runs';
  EXECUTE 'ALTER TABLE fpa.plan_lines DROP CONSTRAINT plan_lines_origin_check';
  EXECUTE 'ALTER TABLE fpa.plan_lines ADD CONSTRAINT plan_lines_origin_check CHECK (origin IN (''actual'', ''driver'', ''manual''))';
  EXECUTE 'ALTER TABLE fpa.plan_lines DROP CONSTRAINT plan_lines_plan_line_def';
  EXECUTE 'DROP INDEX fpa.plan_lines_plan_line';
  EXECUTE 'ALTER TABLE fpa.plan_lines DROP COLUMN budgetable';
  EXECUTE 'ALTER TABLE fpa.line_map DROP CONSTRAINT line_map_plan_line_def';
  EXECUTE 'DROP INDEX fpa.line_map_plan_line';
  EXECUTE 'ALTER TABLE fpa.line_map DROP COLUMN mappable';
  EXECUTE 'DROP INDEX fpa.actuals_monthly_connection_period';
  EXECUTE 'ALTER TABLE fpa.actuals_monthly DROP COLUMN account_name';
  EXECUTE 'DROP TABLE fpa.plan_line_defs';
  EXECUTE 'DELETE FROM fpa.schema_migrations WHERE filename = ''0003_fpa_actuals_budget_variance.sql''';
  RAISE NOTICE '0003 was rolled back.';
END $down$;
