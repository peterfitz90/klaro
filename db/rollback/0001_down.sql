-- Rollback for 0001_fpa_schema.sql. NEVER RUN AUTOMATICALLY. Nothing in this repo runs it, and
-- db/bundle.mjs only embeds it in its rolled-back test.
--
-- It removes the whole fpa schema: every table, function, policy and row in it, including
-- fpa.schema_migrations. It touches nothing outside the fpa schema. Before running it, remove fpa
-- from Supabase's Exposed schemas (an exposed schema that no longer exists can break the API that
-- also serves Ledgrly).
--
-- Two guards, both must be set in the same session before running it:
--   SET fpa.confirm_down = 'yes, remove the fpa schema';
--   SET fpa.confirm_down_with_data = 'yes';   -- only needed if any entity exists
-- Without them it refuses and changes nothing.

DO $down$
BEGIN
  IF to_regnamespace('fpa') IS NULL THEN
    RAISE NOTICE 'There is no fpa schema: nothing to roll back.';
    RETURN;
  END IF;
  IF coalesce(current_setting('fpa.confirm_down', true), '') <> 'yes, remove the fpa schema' THEN
    RAISE EXCEPTION 'Refusing to remove the fpa schema: set fpa.confirm_down to ''yes, remove the fpa schema'' first';
  END IF;
  IF EXISTS (SELECT 1 FROM fpa.entities) AND coalesce(current_setting('fpa.confirm_down_with_data', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'Refusing: the fpa schema holds entities. Export them first, then set fpa.confirm_down_with_data to ''yes''';
  END IF;
  EXECUTE 'DROP SCHEMA fpa CASCADE';
  RAISE NOTICE 'The fpa schema was removed.';
END $down$;
