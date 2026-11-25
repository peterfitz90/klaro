-- PROPOSED, NOT RUN. Remove the Phase 1 walk-through test data (made-up data only), after Gate 1 and
-- ONLY after Peter says so. Inventory: docs/reports/P1-FINAL.md, section 8 (read 25 Nov 2026).
--
-- Plain SQL, one transaction, run as postgres through the connector. Every parent row is named by id
-- and name; every count is checked before and after; any surprise (a row added since the inventory, a
-- locked budget, another entity's data) raises, which rolls everything back. Touches only these two
-- entities' rows in fpa: nothing else in fpa, nothing outside fpa. Not a migration: not recorded in
-- fpa.schema_migrations or Supabase's migration history (both checked unchanged at the end).
-- Re-read the inventory first: if anything was added since 25 Nov, this script stops by design.
BEGIN;
DO $p1_cleanup$
DECLARE
  v_entities constant uuid[] := ARRAY['78d06e2e-619a-4a0e-95cb-bdc55b8dc24d',   -- "test 1"
                                      '5e42034c-9d0a-490e-aeac-4136280221d1']::uuid[];   -- "Walkthrough Test 1"
  v_members  constant uuid[] := ARRAY['f63d9ff1-6cae-4cff-bee0-7870d009c685', '2f511472-d3fa-45a2-ba06-1a26d22d1792']::uuid[];
  v_conns    constant uuid[] := ARRAY['b56bc1d3-0b54-4c12-9306-a33ab3fab7b4', '6d565cdb-227d-4445-ab84-639701fd8c23']::uuid[];
  v_plans    constant uuid[] := ARRAY['7a8eb52d-5216-4e9a-9b48-6e2f2d706632', 'f8ae0f63-d462-485a-a63c-092444aa4c24']::uuid[];
  v_versions constant uuid[] := ARRAY['2da05879-c253-49af-b00d-14b6beaa8cdf',   -- "Budget Jan 2026 to Dec 2026"
                                      '05bccf29-906d-4899-9db2-742664b18d0c']::uuid[];   -- "Budget 2025 (test)"
  v_scenarios constant uuid[] := ARRAY['df87fb3c-1f69-4a60-b360-ca704edea78a', 'db2a4250-30f4-40dc-99ac-b46cb33715fd']::uuid[];
  v_runs     constant uuid[] := ARRAY['d89fca3d-bd79-4fd1-a78b-0074ea0c6289', '95a73c9d-36c5-4863-9bb1-2763c4cff797',
                                      'e2c6fe2f-b56c-4fde-aa47-ba282aeb4769']::uuid[];
  v_n bigint;

  PROCEDURE_NOTE constant text := 'counts as read on 25 Nov 2026';
BEGIN
  -- ── Before: exactly the inventory, nothing more ──────────────────────────────────────────────
  IF (SELECT count(*) FROM fpa.entities WHERE id = ANY (v_entities) AND name IN ('test 1', 'Walkthrough Test 1')) <> 2 THEN
    RAISE EXCEPTION 'expected the 2 test entities by id and name';
  END IF;
  IF (SELECT count(*) FROM fpa.entity_members WHERE entity_id = ANY (v_entities)) <> 2
     OR (SELECT count(*) FROM fpa.entity_members WHERE id = ANY (v_members) AND entity_id = ANY (v_entities)) <> 2 THEN
    RAISE EXCEPTION 'expected exactly the 2 owner memberships';
  END IF;
  IF (SELECT count(*) FROM fpa.connections WHERE entity_id = ANY (v_entities)) <> 2
     OR (SELECT count(*) FROM fpa.connections WHERE id = ANY (v_conns) AND entity_id = ANY (v_entities)) <> 2 THEN
    RAISE EXCEPTION 'expected exactly the 2 CSV connections';
  END IF;
  IF (SELECT count(*) FROM fpa.plans WHERE entity_id = ANY (v_entities)) <> 2
     OR (SELECT count(*) FROM fpa.plans WHERE id = ANY (v_plans) AND entity_id = ANY (v_entities)) <> 2 THEN
    RAISE EXCEPTION 'expected exactly the 2 plans';
  END IF;
  IF (SELECT count(*) FROM fpa.plan_versions WHERE plan_id = ANY (v_plans)) <> 2
     OR (SELECT count(*) FROM fpa.plan_versions WHERE id = ANY (v_versions) AND plan_id = ANY (v_plans)) <> 2 THEN
    RAISE EXCEPTION 'expected exactly the 2 budget versions';
  END IF;
  IF EXISTS (SELECT 1 FROM fpa.plan_versions WHERE id = ANY (v_versions) AND locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'a test budget is locked; an owner must unlock it in the app first (the lock triggers refuse deletes)';
  END IF;
  IF (SELECT count(*) FROM fpa.scenarios WHERE version_id = ANY (v_versions)) <> 2
     OR (SELECT count(*) FROM fpa.scenarios WHERE id = ANY (v_scenarios)) <> 2 THEN
    RAISE EXCEPTION 'expected exactly the 2 base scenarios';
  END IF;
  IF (SELECT count(*) FROM fpa.plan_lines WHERE version_id = ANY (v_versions)) <> 192 THEN RAISE EXCEPTION 'expected 192 budget lines'; END IF;
  IF (SELECT count(*) FROM fpa.line_map WHERE connection_id = ANY (v_conns)) <> 35 THEN RAISE EXCEPTION 'expected 35 mappings'; END IF;
  IF (SELECT count(*) FROM fpa.sync_runs WHERE entity_id = ANY (v_entities)) <> 3
     OR (SELECT count(*) FROM fpa.sync_runs WHERE id = ANY (v_runs)) <> 3 THEN
    RAISE EXCEPTION 'expected exactly the 3 import records';
  END IF;
  IF (SELECT count(*) FROM fpa.actuals_monthly WHERE entity_id = ANY (v_entities)) <> 15193 THEN RAISE EXCEPTION 'expected 15,193 actual rows'; END IF;
  IF EXISTS (SELECT 1 FROM fpa.drivers WHERE plan_id = ANY (v_plans))
     OR EXISTS (SELECT 1 FROM fpa.packs WHERE version_id = ANY (v_versions)) THEN
    RAISE EXCEPTION 'the test entities have drivers or packs; stopping';
  END IF;
  -- The test entities are the only entities: nothing else can be touched.
  IF (SELECT count(*) FROM fpa.entities) <> 2 THEN RAISE EXCEPTION 'there are other entities now; re-read the inventory'; END IF;

  -- ── Delete, children first, each count checked ───────────────────────────────────────────────
  DELETE FROM fpa.plan_lines WHERE version_id = ANY (v_versions);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 192 THEN RAISE EXCEPTION 'deleted % budget lines, expected 192', v_n; END IF;
  DELETE FROM fpa.scenarios WHERE id = ANY (v_scenarios);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 2 THEN RAISE EXCEPTION 'deleted % scenarios, expected 2', v_n; END IF;
  DELETE FROM fpa.plan_versions WHERE id = ANY (v_versions);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 2 THEN RAISE EXCEPTION 'deleted % versions, expected 2', v_n; END IF;
  DELETE FROM fpa.plans WHERE id = ANY (v_plans);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 2 THEN RAISE EXCEPTION 'deleted % plans, expected 2', v_n; END IF;
  DELETE FROM fpa.line_map WHERE connection_id = ANY (v_conns);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 35 THEN RAISE EXCEPTION 'deleted % mappings, expected 35', v_n; END IF;
  DELETE FROM fpa.sync_runs WHERE id = ANY (v_runs);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 3 THEN RAISE EXCEPTION 'deleted % import records, expected 3', v_n; END IF;
  DELETE FROM fpa.actuals_monthly WHERE entity_id = ANY (v_entities);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 15193 THEN RAISE EXCEPTION 'deleted % actual rows, expected 15193', v_n; END IF;
  DELETE FROM fpa.connections WHERE id = ANY (v_conns);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 2 THEN RAISE EXCEPTION 'deleted % connections, expected 2', v_n; END IF;
  DELETE FROM fpa.entity_members WHERE id = ANY (v_members);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 2 THEN RAISE EXCEPTION 'deleted % memberships, expected 2', v_n; END IF;
  DELETE FROM fpa.entities WHERE id = ANY (v_entities);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 2 THEN RAISE EXCEPTION 'deleted % entities, expected 2', v_n; END IF;

  -- ── After: fpa holds no user data; its reference list and both histories are unchanged ────────
  IF (SELECT count(*) FROM fpa.entities) + (SELECT count(*) FROM fpa.entity_members) + (SELECT count(*) FROM fpa.connections)
     + (SELECT count(*) FROM fpa.plans) + (SELECT count(*) FROM fpa.plan_versions) + (SELECT count(*) FROM fpa.plan_lines)
     + (SELECT count(*) FROM fpa.line_map) + (SELECT count(*) FROM fpa.sync_runs) + (SELECT count(*) FROM fpa.actuals_monthly) <> 0 THEN
    RAISE EXCEPTION 'rows remain after the cleanup';
  END IF;
  IF (SELECT count(*) FROM fpa.plan_line_defs) <> 13 THEN RAISE EXCEPTION 'the plan-line list changed'; END IF;
  IF (SELECT count(*) FROM fpa.schema_migrations) <> 2 OR (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 102 THEN
    RAISE EXCEPTION 'migration history changed';
  END IF;
  RAISE NOTICE 'Phase 1 test data removed (%).', PROCEDURE_NOTE;
END $p1_cleanup$;
COMMIT;
