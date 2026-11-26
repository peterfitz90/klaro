-- Assertions run inside the 0004 apply transaction, after 0004 and its fpa.schema_migrations row and
-- immediately before COMMIT (db/bundle.mjs inserts this file and fills in the checksums and the new
-- variance body hash). Any failure raises, so the whole transaction rolls back and nothing is applied.
-- It only reads, so it can be rerun afterwards as a read-only check. Adapted from
-- db/apply_checks_0003.sql: the whole fpa schema is checked as it must be after 0004, not only what
-- 0004 adds; the Phase 1 functions 0004 does not touch must keep their applied bodies (hashes from
-- docs/reports/P1-A-smoke.md). Expected grants: db/tests/GRANTS_EVIDENCE_0004.txt.
DO $apply_check$
DECLARE
  v_bad text[] := '{}';
  v_n bigint;
  v_tables constant text[] := ARRAY['actuals_monthly','balances_monthly','connections','driver_values','drivers','entities','entity_members','line_map',
                                    'packs','plan_line_defs','plan_lines','plan_versions','plans','scenarios','schema_migrations','sync_runs','vat_rules'];
  v_read constant text[] := ARRAY['actuals_monthly','balances_monthly','connections','driver_values','drivers','entities','entity_members','line_map',
                                  'packs','plan_line_defs','plan_lines','plan_versions','plans','scenarios','sync_runs','vat_rules'];
  v_remove constant text[] := ARRAY['driver_values','drivers','line_map','packs','plan_lines','plan_versions','plans','scenarios'];
  v_fn_auth constant text[] := ARRAY['account_map','add_member','balance_accounts','cash_position','create_budget_from_actuals','create_entity',
                                     'import_actuals','import_balances','is_entity_member','member_for_connection','member_for_driver','member_for_plan',
                                     'member_for_scenario','member_for_version','member_in_jurisdiction','my_entity_ids','save_budget_lines',
                                     'set_line_map','set_member','unmapped_accounts','variance'];
  v_fn_invoker constant text[] := ARRAY['account_map','balance_accounts','cash_position','create_budget_from_actuals','save_budget_lines',
                                        'set_line_map','unmapped_accounts','variance'];
  v_fn_internal constant text[] := ARRAY['check_driver_value_plan','connection_entity','driver_entity','guard_locked_child',
                                         'guard_locked_driver_value','guard_locked_version','plan_entity','scenario_entity',
                                         'touch_updated_at','version_entity'];
BEGIN
  -- 1. Exactly the 17 tables, each with row security on; nothing but tables and indexes.
  SELECT count(*) INTO v_n FROM pg_class c
   WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity AND c.relname = ANY (v_tables);
  IF v_n <> 17 OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r') <> 17 THEN
    v_bad := v_bad || format('tables with row security: %s of 17', v_n);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind NOT IN ('r', 'i')) THEN
    v_bad := v_bad || 'relations other than tables and indexes'::text;
  END IF;
  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'fpa') <> 43
     OR EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'fpa' AND p.roles <> '{authenticated}')
     OR (SELECT string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, ''), ',' ORDER BY p.policyname) FROM pg_policies p
          WHERE p.schemaname = 'fpa' AND p.tablename IN ('plan_line_defs', 'sync_runs'))
        IS DISTINCT FROM 'plan_line_defs_read:SELECT:true,sync_runs_read:SELECT:fpa.is_entity_member(entity_id, ''viewer''::text)' THEN
    v_bad := v_bad || 'policies are not exactly the 43 (42 + balances_monthly_read), all TO authenticated'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'fpa' AND p.tablename = 'balances_monthly' AND p.policyname = 'balances_monthly_read'
                   AND p.cmd = 'SELECT' AND p.roles = '{authenticated}' AND p.qual ~ '^\(?entity_id = ANY \(ARRAY\(' AND p.qual ~ 'fpa\.my_entity_ids\(''viewer''::text\)')
     OR (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'fpa' AND p.tablename = 'balances_monthly') <> 1 THEN
    v_bad := v_bad || 'balances_monthly does not have exactly its read policy (my_entity_ids viewer, once per query)'::text;
  END IF;
  -- The two read policies 0003 changes: membership through my_entity_ids, evaluated once per query
  -- (inside ARRAY(SELECT ...)), with no per-row membership helper left.
  IF NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'fpa' AND p.policyname = 'actuals_monthly_read' AND p.cmd = 'SELECT'
                   AND p.roles = '{authenticated}' AND p.qual ~ '^\(?entity_id = ANY \(ARRAY\(' AND p.qual ~ 'fpa\.my_entity_ids\(''viewer''::text\)'
                   AND p.qual !~ 'is_entity_member')
     OR NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'fpa' AND p.policyname = 'line_map_read' AND p.cmd = 'SELECT'
                   AND p.roles = '{authenticated}' AND p.qual ~ '^\(?connection_id IN \(' AND p.qual ~ 'fpa\.connections'
                   AND p.qual ~ 'entity_id = ANY \(ARRAY\(' AND p.qual ~ 'fpa\.my_entity_ids\(''viewer''::text\)'
                   AND p.qual !~ 'member_for_connection') THEN
    v_bad := v_bad || 'actuals_monthly_read or line_map_read is not the 0003 definition (my_entity_ids, once per query)'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'fpa.my_entity_ids(text)'::regprocedure AND p.prosecdef AND p.provolatile = 's' AND p.proretset) THEN
    v_bad := v_bad || 'fpa.my_entity_ids is not a STABLE SECURITY DEFINER set-returning function'::text;
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
  IF v_n <> 0 OR (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace) <> 31 THEN
    v_bad := v_bad || 'the function list differs from the evidence (expected 31 functions)'::text;
  END IF;
  IF (SELECT string_agg(p.proname, ',' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND NOT p.prosecdef
        AND p.proname NOT IN ('touch_updated_at', 'guard_locked_version', 'guard_locked_child', 'guard_locked_driver_value', 'check_driver_value_plan'))
     IS DISTINCT FROM array_to_string(v_fn_invoker, ',') THEN
    v_bad := v_bad || 'the SECURITY INVOKER API functions are not exactly the five 0003 and three 0004 functions'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = 'fpa.import_balances(uuid,uuid,jsonb,text)'::regprocedure AND p.prosecdef AND p.provolatile = 'v') THEN
    v_bad := v_bad || 'fpa.import_balances is not a VOLATILE SECURITY DEFINER function'::text;
  END IF;
  IF pg_get_function_result(to_regprocedure('fpa.cash_position(uuid)')) IS DISTINCT FROM
     'TABLE(latest_month date, months_available integer, unmapped_accounts integer, cash_accounts integer, month date, has_balances boolean, cash numeric)' THEN
    v_bad := v_bad || 'fpa.cash_position does not return the reviewed columns (including cash_accounts)'::text;
  END IF;
  -- The Phase 1 functions 0004 does not touch keep their applied bodies; variance is exactly the 0004 text.
  IF (SELECT string_agg(p.proname || ':' || md5(p.prosrc), ',' ORDER BY p.proname) FROM pg_proc p
       WHERE p.pronamespace = 'fpa'::regnamespace
         AND p.proname IN ('account_map', 'create_budget_from_actuals', 'import_actuals', 'my_entity_ids', 'set_line_map', 'unmapped_accounts', 'variance'))
     IS DISTINCT FROM 'account_map:eac1d305aeec598ab3dddb55d22d599e,create_budget_from_actuals:aca1c2a69cbb5d6de56e0f475f88c935,'
       'import_actuals:1eaa34a5dc880ad0e9ff03cbf90254de,my_entity_ids:1d476671d777d4095281c9b34b462c81,set_line_map:61d261d6c9b7640bd566d8d6ec71e99f,'
       'unmapped_accounts:da55d23687b8603f7d0ce115efc82fb7,variance:__MD5_VARIANCE_0004__' THEN
    v_bad := v_bad || 'a Phase 1 function body changed, or variance is not the 0004 text'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'fpa'::regnamespace AND p.proname = ANY (v_fn_invoker)
              AND NOT coalesce(p.proconfig::text LIKE '%search_path=fpa, pg_temp%', false)) THEN
    v_bad := v_bad || 'an invoker API function has no fixed search_path'::text;
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

  -- 3. anon and PUBLIC have no access to anything in the schema (service_role neither, in Phase 1).
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

  -- 5. fpa.schema_migrations holds exactly 0001, 0003 and 0004 with their checksums; no draft; no VAT
  --    rules (0002 not applied).
  SELECT count(*) INTO v_n FROM (
    (SELECT filename, checksum FROM fpa.schema_migrations
     EXCEPT VALUES ('0001_fpa_schema.sql', '__CHECKSUM_0001__'), ('0003_fpa_actuals_budget_variance.sql', '__CHECKSUM_0003__'),
                   ('0004_fpa_balances_cash.sql', '__CHECKSUM_0004__'))
    UNION ALL
    (VALUES ('0001_fpa_schema.sql', '__CHECKSUM_0001__'), ('0003_fpa_actuals_budget_variance.sql', '__CHECKSUM_0003__'),
            ('0004_fpa_balances_cash.sql', '__CHECKSUM_0004__')
     EXCEPT SELECT filename, checksum FROM fpa.schema_migrations)) d;
  IF v_n <> 0 OR (SELECT count(*) FROM fpa.schema_migrations) <> 3 THEN
    v_bad := v_bad || 'fpa.schema_migrations does not hold exactly 0001, 0003 and 0004 with their checksums'::text;
  END IF;
  IF EXISTS (SELECT 1 FROM fpa.schema_migrations WHERE filename ~* 'draft') OR EXISTS (SELECT 1 FROM fpa.vat_rules) THEN
    v_bad := v_bad || 'a DRAFT file is recorded or VAT rules exist (0002 must not be applied)'::text;
  END IF;

  -- 6. The plan-line list is exactly the seed; the constraints 0003 adds are in place.
  IF (SELECT string_agg(format('%s:%s:%s:%s:%s', d.key, d.label, d.kind, d.sort_order, d.display_sign), ',' ORDER BY d.sort_order) FROM fpa.plan_line_defs d)
     IS DISTINCT FROM 'revenue:Revenue:income:10:-1,cost_of_sales:Cost of sales:cost:20:1,gross_profit:Gross profit:calculated:30:-1,payroll:Payroll:cost:40:1,'
       'marketing:Marketing:cost:50:1,premises:Rent and premises:cost:60:1,other_operating:Other operating costs:cost:70:1,'
       'operating_profit:Operating profit:calculated:80:-1,interest:Interest:cost:90:1,tax:Tax:cost:100:1,net_profit:Net profit:calculated:110:-1,'
       'unmapped:Unmapped:unmapped:120:1,excluded:Not in the P&L (excluded):excluded:130:1,cash_bank:Cash and bank:balance:140:1' THEN
    v_bad := v_bad || 'fpa.plan_line_defs is not exactly the agreed list (13 Phase 1 lines and Cash and bank)'::text;
  END IF;
  IF (SELECT string_agg(d.key, ',' ORDER BY d.sort_order) FROM fpa.plan_line_defs d WHERE d.mappable)
       IS DISTINCT FROM 'revenue,cost_of_sales,payroll,marketing,premises,other_operating,interest,tax,excluded,cash_bank'
     OR (SELECT string_agg(d.key, ',' ORDER BY d.sort_order) FROM fpa.plan_line_defs d WHERE d.budgetable)
       IS DISTINCT FROM 'revenue,cost_of_sales,payroll,marketing,premises,other_operating,interest,tax' THEN
    v_bad := v_bad || 'mappable or budgetable lines are not as agreed (Cash and bank mappable, never budgetable)'::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'fpa' AND c.table_name = 'sync_runs' AND c.column_name = 'kind'
                   AND c.is_nullable = 'NO' AND c.column_default = '''actuals''::text')
     OR pg_get_constraintdef((SELECT k.oid FROM pg_constraint k WHERE k.conrelid = 'fpa.sync_runs'::regclass AND k.contype = 'c'
                                AND pg_get_constraintdef(k.oid) LIKE '%kind%')) NOT LIKE '%actuals%balances%' THEN
    v_bad := v_bad || 'sync_runs.kind is missing, nullable, not defaulting to actuals, or not limited to actuals and balances'::text;
  END IF;
  IF (SELECT string_agg(k.conname, ',' ORDER BY k.conname) FROM pg_constraint k
       WHERE k.connamespace = 'fpa'::regnamespace AND k.conname IN ('line_map_plan_line_def', 'plan_lines_plan_line_def', 'plan_lines_origin_check')
         AND k.convalidated) IS DISTINCT FROM 'line_map_plan_line_def,plan_lines_origin_check,plan_lines_plan_line_def'
     OR pg_get_constraintdef((SELECT k.oid FROM pg_constraint k WHERE k.conname = 'plan_lines_origin_check' AND k.connamespace = 'fpa'::regnamespace))
        NOT LIKE '%from_actuals%' THEN
    v_bad := v_bad || 'the 0003 constraints (plan-line foreign keys, origin check) are missing or not validated'::text;
  END IF;

  IF coalesce(array_length(v_bad, 1), 0) > 0 THEN
    RAISE EXCEPTION 'Apply check failed, nothing was applied: %', array_to_string(v_bad, ' | ');
  END IF;
END $apply_check$;
