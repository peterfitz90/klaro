-- One-off: remove the two entities created by the B5 end-to-end test on production (24 Nov 2026),
-- with their memberships and default plans. Plain SQL, one transaction, run as postgres through the
-- connector ONLY after Peter's OK. Every row is named by id; the counts are checked before and after,
-- and any surprise raises, which rolls everything back. Touches nothing outside fpa and nothing else in
-- fpa. Not a migration: it is not recorded in fpa.schema_migrations or Supabase's migration history.
BEGIN;
DO $b5_cleanup$
DECLARE
  v_entities constant uuid[] := ARRAY['414534bc-d432-4e97-a9df-f4948dc0c962', '9b06b1e8-d8ba-414a-a953-d7fdae530c9b']::uuid[];
  v_members  constant uuid[] := ARRAY['aae5607d-88d6-4275-9b75-4bb06914750c', '61c9760a-f1e1-4077-9e6c-bee939d0f04d']::uuid[];
  v_plans    constant uuid[] := ARRAY['723b647c-c6bd-4adf-9373-572dc43f4f89', 'ad880758-2294-40b1-96ed-47b2a0528e34']::uuid[];
  v_n bigint;
BEGIN
  -- Before: exactly these rows, with these names, and nothing hanging off them.
  IF (SELECT count(*) FROM fpa.entities WHERE id = ANY (v_entities) AND name IN ('B5 Test A', 'B5 Test B')) <> 2 THEN
    RAISE EXCEPTION 'expected the 2 B5 test entities by id and name';
  END IF;
  IF (SELECT count(*) FROM fpa.entity_members WHERE id = ANY (v_members) AND entity_id = ANY (v_entities)) <> 2
     OR (SELECT count(*) FROM fpa.entity_members WHERE entity_id = ANY (v_entities)) <> 2 THEN
    RAISE EXCEPTION 'expected exactly 2 memberships on the test entities';
  END IF;
  IF (SELECT count(*) FROM fpa.plans WHERE id = ANY (v_plans) AND entity_id = ANY (v_entities)) <> 2
     OR (SELECT count(*) FROM fpa.plans WHERE entity_id = ANY (v_entities)) <> 2 THEN
    RAISE EXCEPTION 'expected exactly 2 plans on the test entities';
  END IF;
  IF EXISTS (SELECT 1 FROM fpa.plan_versions v WHERE v.plan_id = ANY (v_plans))
     OR EXISTS (SELECT 1 FROM fpa.drivers d WHERE d.plan_id = ANY (v_plans))
     OR EXISTS (SELECT 1 FROM fpa.connections c WHERE c.entity_id = ANY (v_entities))
     OR EXISTS (SELECT 1 FROM fpa.actuals_monthly a WHERE a.entity_id = ANY (v_entities)) THEN
    RAISE EXCEPTION 'the test entities have more data than expected; stopping';
  END IF;

  DELETE FROM fpa.entity_members WHERE id = ANY (v_members);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 2 THEN RAISE EXCEPTION 'deleted % memberships, expected 2', v_n; END IF;
  DELETE FROM fpa.plans WHERE id = ANY (v_plans);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 2 THEN RAISE EXCEPTION 'deleted % plans, expected 2', v_n; END IF;
  DELETE FROM fpa.entities WHERE id = ANY (v_entities);
  GET DIAGNOSTICS v_n = ROW_COUNT; IF v_n <> 2 THEN RAISE EXCEPTION 'deleted % entities, expected 2', v_n; END IF;

  -- After: fpa holds no entity, membership or plan; its own history and Supabase's are unchanged.
  IF (SELECT count(*) FROM fpa.entities) + (SELECT count(*) FROM fpa.entity_members) + (SELECT count(*) FROM fpa.plans) <> 0 THEN
    RAISE EXCEPTION 'rows remain after the cleanup';
  END IF;
  IF (SELECT count(*) FROM fpa.schema_migrations) <> 1 OR (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 102 THEN
    RAISE EXCEPTION 'migration history changed';
  END IF;
END $b5_cleanup$;
COMMIT;
