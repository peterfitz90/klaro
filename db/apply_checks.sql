-- Assertions run inside the apply transaction, after 0001 and its fpa.schema_migrations row and
-- immediately before COMMIT (db/bundle.mjs inserts this file and fills in the checksum). Any failure
-- raises, so the whole transaction rolls back and nothing is applied. It only reads, so it can be
-- rerun afterwards as a read-only check. The expected grants are those in db/tests/GRANTS_EVIDENCE.txt.
DO $apply_check$
DECLARE
  v_bad text[] := '{}';
  v_n bigint;
  v_tables constant text[] := ARRAY['actuals_monthly','connections','driver_values','drivers','entities','entity_members','line_map',
                                    'packs','plan_lines','plan_versions','plans','scenarios','schema_migrations','vat_rules'];
  v_read constant text[] := ARRAY['actuals_monthly','connections','driver_values','drivers','entities','entity_members','line_map',
                                  'packs','plan_lines','plan_versions','plans','scenarios','vat_rules'];
  v_remove constant text[] := ARRAY['driver_values','drivers','line_map','packs','plan_lines','plan_versions','plans','scenarios'];
  v_fn_auth constant text[] := ARRAY['add_member','create_entity','is_entity_member','member_for_connection','member_for_driver',
                                     'member_for_plan','member_for_scenario','member_for_version','member_in_jurisdiction','set_member'];
  v_fn_internal constant text[] := ARRAY['check_driver_value_plan','connection_entity','driver_entity','guard_locked_child',
                                         'guard_locked_driver_value','guard_locked_version','plan_entity','scenario_entity',
                                         'touch_updated_at','version_entity'];
BEGIN
  -- 1. Exactly the 14 tables, each with row security on; nothing but tables and indexes.
  SELECT count(*) INTO v_n FROM pg_class c
   WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity AND c.relname = ANY (v_tables);
  IF v_n <> 14 OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r') <> 14 THEN
    v_bad := v_bad || format('tables with row security: %s of 14', v_n);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind NOT IN ('r', 'i')) THEN
    v_bad := v_bad || 'relations other than tables and indexes'::text;
  END IF;
  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'fpa') <> 40
     OR EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'fpa' AND p.roles <> '{authenticated}') THEN
    v_bad := v_bad || 'policies are not exactly the 40, all TO authenticated'::text;
  END IF;

  -- 2. Grants match GRANTS_EVIDENCE.txt exactly (owner's own privileges excluded; any extra grant, to
  --    anyone including PUBLIC, or any missing grant, fails).
  WITH actual AS (
    SELECT c.relname::text AS obj, a.grantee, a.privilege_type FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
     WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND a.grantee <> c.relowner),
  expected AS (
    SELECT t AS obj, 'authenticated'::regrole::oid AS grantee, 'SELECT'::text AS privilege_type FROM unnest(v_read) t
    UNION ALL SELECT t, 'authenticated'::regrole::oid, 'DELETE' FROM unnest(v_remove) t)
  SELECT count(*) INTO v_n FROM ((SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) d;
  IF v_n <> 0 THEN v_bad := v_bad || format('table grants differ from the evidence (%s differences)', v_n); END IF;

  WITH actual AS (
    SELECT c.relname || '.' || at.attname AS obj, a.grantee, a.privilege_type
      FROM pg_class c JOIN pg_attribute at ON at.attrelid = c.oid, aclexplode(at.attacl) a
     WHERE c.relnamespace = 'fpa'::regnamespace AND at.attacl IS NOT NULL AND NOT at.attisdropped),
  spec (tbl, priv, cols) AS (VALUES
    ('entities', 'UPDATE', 'name,vat_scheme,vat_cycle_anchor'),
    ('connections', 'INSERT', 'entity_id,source_type'), ('connections', 'UPDATE', 'status'),
    ('plans', 'INSERT', 'entity_id,name,fiscal_year_start,horizon_months'), ('plans', 'UPDATE', 'name,fiscal_year_start,horizon_months'),
    ('plan_versions', 'INSERT', 'plan_id,kind,name,based_on_version_id'), ('plan_versions', 'UPDATE', 'name,locked_at'),
    ('scenarios', 'INSERT', 'version_id,name,is_base'), ('scenarios', 'UPDATE', 'name,is_base'),
    ('drivers', 'INSERT', 'plan_id,key,label,unit,kind'), ('drivers', 'UPDATE', 'label,unit,kind'),
    ('driver_values', 'INSERT', 'driver_id,scenario_id,period,value'), ('driver_values', 'UPDATE', 'value'),
    ('line_map', 'INSERT', 'connection_id,account_code,plan_line,vat_rate_code'), ('line_map', 'UPDATE', 'plan_line,vat_rate_code'),
    ('plan_lines', 'INSERT', 'version_id,scenario_id,plan_line,period,amount,origin'), ('plan_lines', 'UPDATE', 'amount,origin'),
    ('packs', 'INSERT', 'version_id,scenario_id,period,narrative,file_path'), ('packs', 'UPDATE', 'narrative,file_path')),
  expected AS (
    SELECT s.tbl || '.' || col AS obj, 'authenticated'::regrole::oid AS grantee, s.priv AS privilege_type FROM spec s, unnest(string_to_array(s.cols, ',')) col)
  SELECT count(*) INTO v_n FROM ((SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) d;
  IF v_n <> 0 THEN v_bad := v_bad || format('column grants differ from the evidence (%s differences)', v_n); END IF;

  SELECT count(*) INTO v_n FROM ((SELECT p.proname::text FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace
                                  EXCEPT SELECT unnest(v_fn_auth || v_fn_internal))
                       UNION ALL (SELECT unnest(v_fn_auth || v_fn_internal)
                                  EXCEPT SELECT p.proname::text FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace)) d;
  IF v_n <> 0 OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace) <> 20 THEN
    v_bad := v_bad || 'the function list differs from the evidence (expected 20 functions)'::text;
  END IF;
  WITH actual AS (
    SELECT p.proname::text AS obj, a.grantee, a.privilege_type FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.pronamespace = 'fpa'::regnamespace AND a.grantee <> p.proowner),
  expected AS (SELECT f AS obj, 'authenticated'::regrole::oid AS grantee, 'EXECUTE'::text AS privilege_type FROM unnest(v_fn_auth) f)
  SELECT count(*) INTO v_n FROM ((SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) d;
  IF v_n <> 0 THEN v_bad := v_bad || format('function EXECUTE grants differ from the evidence (%s differences)', v_n); END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND p.prosecdef
              AND NOT coalesce(p.proconfig::text LIKE '%search_path=fpa, pg_temp%', false)) THEN
    v_bad := v_bad || 'a SECURITY DEFINER function has no fixed search_path'::text;
  END IF;

  WITH actual AS (
    SELECT a.grantee, a.privilege_type FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname = 'fpa' AND a.grantee <> n.nspowner),
  expected AS (SELECT 'authenticated'::regrole::oid AS grantee, 'USAGE'::text AS privilege_type)
  SELECT count(*) INTO v_n FROM ((SELECT * FROM actual EXCEPT SELECT * FROM expected) UNION ALL (SELECT * FROM expected EXCEPT SELECT * FROM actual)) d;
  IF v_n <> 0 THEN v_bad := v_bad || 'schema grants differ from the evidence'::text; END IF;

  -- 3. anon and PUBLIC have no access to anything in the schema (service_role neither, in Phase 0).
  IF has_schema_privilege('anon', 'fpa', 'USAGE') OR has_schema_privilege('anon', 'fpa', 'CREATE')
     OR has_schema_privilege('service_role', 'fpa', 'USAGE') THEN
    v_bad := v_bad || 'anon or service_role has a schema privilege'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind <> 'i'
              AND (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
                   OR has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
    v_bad := v_bad || 'anon has a table or column privilege'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND has_function_privilege('anon', p.oid, 'EXECUTE')) THEN
    v_bad := v_bad || 'anon can execute a function'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a WHERE n.nspname = 'fpa' AND a.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a WHERE c.relnamespace = 'fpa'::regnamespace AND a.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_attribute at ON at.attrelid = c.oid, aclexplode(at.attacl) a WHERE c.relnamespace = 'fpa'::regnamespace AND a.grantee = 0)
     OR EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE p.pronamespace = 'fpa'::regnamespace AND a.grantee = 0) THEN
    v_bad := v_bad || 'PUBLIC has a privilege'::text;
  END IF;

  -- 4. No foreign key from fpa into another schema (nothing in fpa refers to Ledgrly).
  IF EXISTS (SELECT 1 FROM pg_constraint k WHERE k.connamespace = 'fpa'::regnamespace AND k.contype = 'f'
              AND k.confrelid::regclass::text NOT LIKE 'fpa.%') THEN
    v_bad := v_bad || 'a foreign key leaves the fpa schema'::text;
  END IF;

  -- 5. fpa.schema_migrations holds exactly 0001 with its checksum; no draft; no VAT rules (0002 not applied).
  SELECT count(*) INTO v_n FROM (
    (SELECT filename, checksum FROM fpa.schema_migrations EXCEPT VALUES ('0001_fpa_schema.sql', '__CHECKSUM_0001__'))
    UNION ALL
    (VALUES ('0001_fpa_schema.sql', '__CHECKSUM_0001__') EXCEPT SELECT filename, checksum FROM fpa.schema_migrations)) d;
  IF v_n <> 0 OR (SELECT count(*) FROM fpa.schema_migrations) <> 1 THEN
    v_bad := v_bad || 'fpa.schema_migrations does not hold exactly 0001 with its checksum'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM fpa.schema_migrations WHERE filename ~* 'draft') OR EXISTS (SELECT 1 FROM fpa.vat_rules) THEN
    v_bad := v_bad || 'a DRAFT file is recorded or VAT rules exist (0002 must not be applied)'::text;
  END IF;

  IF coalesce(array_length(v_bad, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Apply check failed, nothing was applied: %', array_to_string(v_bad, ' | ');
  END IF;
END $apply_check$;
