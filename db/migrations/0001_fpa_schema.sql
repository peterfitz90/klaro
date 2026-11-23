-- 0001: the fpa schema (Klaro Phase 0). Applied only with Peter's approval, as plain SQL in one
-- transaction (db/out/apply_0001.sql, built by db/bundle.mjs). That transaction also records this
-- file and its checksum in fpa.schema_migrations and runs db/apply_checks.sql before COMMIT. It does
-- not use Supabase's migration feature, so nothing enters Supabase's migration history. It touches
-- nothing outside the fpa schema and has no foreign key into any Ledgrly table.
--
-- Access model
--   anon           nothing at all (no USAGE on the schema).
--   service_role   nothing in Phase 0 (no server functions yet; Phase 1 grants what the sync needs).
--   authenticated  through row security, by membership in fpa.entity_members (Clerk user id =
--                  auth.jwt()->>'sub'; viewer < editor < owner; inactive members get nothing):
--                    viewer  reads everything of the entity;
--                    editor  also writes plan data (plans, versions, scenarios, drivers, values,
--                            line map, plan lines, packs), including deletes;
--                    owner   also renames the entity, adds connections, manages members (functions).
--                  actuals_monthly, vat_rules, connections.last_synced_at/actuals_through and
--                  entity_members are never written directly by authenticated.
-- Money is numeric(14,2) in the entity's currency. Periods are the first day of a month.
-- Errors raised for users use codes PTnnn (PostgREST maps them to HTTP status nnn).

CREATE SCHEMA IF NOT EXISTS fpa;
REVOKE ALL ON SCHEMA fpa FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA fpa TO authenticated;

-- ── Tables ───────────────────────────────────────────────────────────────────────────────────
CREATE TABLE fpa.schema_migrations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename   text NOT NULL UNIQUE CHECK (filename ~ '^\d{4}_[a-z0-9_]+\.sql$' AND filename !~* 'draft'),
  checksum   text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fpa.entities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120 AND name = btrim(name)),
  jurisdiction       text NOT NULL CHECK (jurisdiction IN ('IE', 'UK')),
  currency           text NOT NULL CHECK (currency IN ('EUR', 'GBP')),
  vat_scheme         text NOT NULL DEFAULT 'standard' CHECK (vat_scheme IN ('standard', 'cash_basis', 'flat_rate', 'not_registered')),
  vat_cycle_anchor   smallint CHECK (vat_cycle_anchor BETWEEN 1 AND 12),   -- first month of a VAT period; NULL = not set
  ledgrly_company_id uuid,                                                -- for a later connector; deliberately no foreign key
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fpa.entity_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES fpa.entities(id),
  clerk_user_id text NOT NULL CHECK (clerk_user_id ~ '^user_[A-Za-z0-9]{1,64}$'),
  role          text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, clerk_user_id)
);
CREATE INDEX entity_members_user ON fpa.entity_members (clerk_user_id) WHERE is_active;

CREATE TABLE fpa.connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES fpa.entities(id),
  source_type     text NOT NULL CHECK (source_type IN ('ledgrly', 'accounting_package', 'mcp', 'csv')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'error', 'disabled')),
  last_synced_at  timestamptz,
  actuals_through date CHECK (actuals_through = date_trunc('month', actuals_through)::date),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, entity_id)   -- target of actuals_monthly's composite key
);
CREATE INDEX connections_entity ON fpa.connections (entity_id);

CREATE TABLE fpa.actuals_monthly (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL,
  connection_id uuid NOT NULL,
  account_code  text NOT NULL CHECK (length(account_code) BETWEEN 1 AND 64),
  period        date NOT NULL CHECK (period = date_trunc('month', period)::date),
  amount        numeric(14,2) NOT NULL,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, account_code, period),
  -- The row's entity is the connection's entity: no mixing entities through a connection.
  FOREIGN KEY (connection_id, entity_id) REFERENCES fpa.connections (id, entity_id)
);
CREATE INDEX actuals_monthly_entity_period ON fpa.actuals_monthly (entity_id, period);

CREATE TABLE fpa.vat_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction     text NOT NULL CHECK (jurisdiction IN ('IE', 'UK')),
  rate_code        text NOT NULL CHECK (rate_code ~ '^[A-Z0-9_]{1,32}$'),
  rate             numeric(5,2) CHECK (rate BETWEEN 0 AND 100),             -- percent; NULL on a filing-rule row
  filing_frequency text CHECK (filing_frequency IN ('monthly', 'bi_monthly', 'quarterly', 'four_monthly', 'six_monthly', 'annual')),
  due_day_rule     text CHECK (length(due_day_rule) BETWEEN 1 AND 200),
  effective_from   date NOT NULL,
  verified_at      timestamptz,                                              -- NULL until Peter has checked it
  source_url       text CHECK (source_url ~ '^https://'),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (jurisdiction, rate_code, effective_from),
  CHECK (rate IS NOT NULL OR filing_frequency IS NOT NULL),
  CHECK ((filing_frequency IS NULL) = (due_day_rule IS NULL)),
  CHECK (verified_at IS NULL OR source_url IS NOT NULL)
);

CREATE TABLE fpa.plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES fpa.entities(id),
  name              text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  fiscal_year_start smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start BETWEEN 1 AND 12),   -- month
  horizon_months    smallint NOT NULL DEFAULT 12 CHECK (horizon_months BETWEEN 1 AND 60),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plans_entity ON fpa.plans (entity_id);

CREATE TABLE fpa.plan_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id             uuid NOT NULL REFERENCES fpa.plans(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('budget', 'forecast')),
  name                text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  locked_at           timestamptz,   -- set by the server when locked (editor or owner)
  locked_by           text,          -- Clerk user id of whoever locked it last
  unlocked_at         timestamptz,   -- when it was last unlocked (owner only)
  unlocked_by         text,          -- Clerk user id of whoever unlocked it last
  based_on_version_id uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, plan_id),
  -- A version can only be based on another version of the same plan.
  FOREIGN KEY (based_on_version_id, plan_id) REFERENCES fpa.plan_versions (id, plan_id) ON DELETE SET NULL (based_on_version_id),
  CHECK (based_on_version_id <> id)
);
CREATE INDEX plan_versions_plan ON fpa.plan_versions (plan_id);
CREATE INDEX plan_versions_based_on ON fpa.plan_versions (based_on_version_id);

CREATE TABLE fpa.scenarios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES fpa.plan_versions(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  is_base    boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, name),
  UNIQUE (id, version_id)   -- target of plan_lines' and packs' composite keys
);
CREATE UNIQUE INDEX scenarios_one_base ON fpa.scenarios (version_id) WHERE is_base;

CREATE TABLE fpa.drivers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id    uuid NOT NULL REFERENCES fpa.plans(id) ON DELETE CASCADE,
  key        text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
  label      text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  unit       text NOT NULL CHECK (unit IN ('currency', 'percent', 'count', 'months', 'days', 'ratio')),
  kind       text NOT NULL CHECK (kind IN ('input', 'calculated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, key)
);

CREATE TABLE fpa.driver_values (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES fpa.drivers(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES fpa.scenarios(id) ON DELETE CASCADE,
  period      date NOT NULL CHECK (period = date_trunc('month', period)::date),
  value       numeric(18,6) NOT NULL,   -- drivers include rates and counts, so six decimals; never float
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, scenario_id, period)
);
CREATE INDEX driver_values_scenario_period ON fpa.driver_values (scenario_id, period);

CREATE TABLE fpa.line_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES fpa.connections(id) ON DELETE CASCADE,
  account_code  text NOT NULL CHECK (length(account_code) BETWEEN 1 AND 64),
  plan_line     text NOT NULL CHECK (plan_line ~ '^[a-z][a-z0-9_.]{0,79}$'),
  vat_rate_code text CHECK (vat_rate_code ~ '^[A-Z0-9_]{1,32}$'),   -- matches vat_rules.rate_code; rules are dated, so no foreign key
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, account_code)
);

CREATE TABLE fpa.plan_lines (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  uuid NOT NULL REFERENCES fpa.plan_versions(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL,
  plan_line   text NOT NULL CHECK (plan_line ~ '^[a-z][a-z0-9_.]{0,79}$'),
  period      date NOT NULL CHECK (period = date_trunc('month', period)::date),
  amount      numeric(14,2),
  origin      text NOT NULL CHECK (origin IN ('actual', 'driver', 'manual')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, scenario_id, plan_line, period),
  -- The scenario must belong to the same version.
  FOREIGN KEY (scenario_id, version_id) REFERENCES fpa.scenarios (id, version_id) ON DELETE CASCADE,
  -- Actual lines are read from actuals_monthly, never stored; the others always carry an amount.
  CONSTRAINT plan_lines_amount_by_origin CHECK ((origin = 'actual') = (amount IS NULL))
);
CREATE INDEX plan_lines_scenario_period ON fpa.plan_lines (scenario_id, period);

CREATE TABLE fpa.packs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id  uuid NOT NULL REFERENCES fpa.plan_versions(id) ON DELETE CASCADE,
  scenario_id uuid,
  period      date NOT NULL CHECK (period = date_trunc('month', period)::date),
  narrative   text CHECK (length(narrative) <= 50000),
  file_path   text CHECK (file_path ~ '^[A-Za-z0-9/_.-]{1,300}$' AND file_path !~ '\.\.'),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (scenario_id, version_id) REFERENCES fpa.scenarios (id, version_id) ON DELETE CASCADE
);
CREATE INDEX packs_version_period ON fpa.packs (version_id, period);
CREATE INDEX packs_scenario ON fpa.packs (scenario_id);

-- ── Triggers ─────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION fpa.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = fpa, pg_temp AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DO $touch$
DECLARE v_t text;
BEGIN
  FOR v_t IN SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'fpa'::regnamespace AND c.relkind = 'r' LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON fpa.%I FOR EACH ROW EXECUTE FUNCTION fpa.touch_updated_at()', v_t || '_updated_at', v_t);
  END LOOP;
END $touch$;

-- A locked version is read-only: its scenarios, plan lines, driver values and packs cannot change,
-- and it cannot be renamed or removed until it is unlocked. Runs as the caller: a row the caller
-- cannot see is left to row security, which refuses it anyway.
-- One trigger function per row shape, so each can be checked statically (plpgsql_check).
-- Parent keys are not updatable (column grants), so a row's version is the same before and after.
-- On plan_versions: editors and owners may lock; only an owner may unlock (an API caller who is not
-- an owner gets PT403). The server records who locked or unlocked and when; the audit columns are
-- not writable by the API (column grants) and any value sent for them is replaced.
CREATE FUNCTION fpa.guard_locked_version() RETURNS trigger LANGUAGE plpgsql SET search_path = fpa, pg_temp AS $$
DECLARE v_sub text := auth.jwt() ->> 'sub';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.locked_at IS NOT NULL THEN
      RAISE EXCEPTION 'This version is locked. Unlock it first.' USING ERRCODE = 'PT423';
    END IF;
    RETURN OLD;
  END IF;
  NEW.locked_by := OLD.locked_by; NEW.unlocked_at := OLD.unlocked_at; NEW.unlocked_by := OLD.unlocked_by;
  IF OLD.locked_at IS NULL AND NEW.locked_at IS NOT NULL THEN
    NEW.locked_at := now();
    NEW.locked_by := v_sub;
  ELSIF OLD.locked_at IS NOT NULL AND NEW.locked_at IS NULL THEN
    IF current_user = 'authenticated' AND NOT fpa.member_for_plan(OLD.plan_id, 'owner') THEN
      RAISE EXCEPTION 'Only an owner can unlock a version.' USING ERRCODE = 'PT403';
    END IF;
    NEW.unlocked_at := now();
    NEW.unlocked_by := v_sub;
  ELSIF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This version is locked. Unlock it first.' USING ERRCODE = 'PT423';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION fpa.guard_locked_child() RETURNS trigger LANGUAGE plpgsql SET search_path = fpa, pg_temp AS $$
DECLARE v_version uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_version := OLD.version_id; ELSE v_version := NEW.version_id; END IF;
  IF EXISTS (SELECT 1 FROM fpa.plan_versions v WHERE v.id = v_version AND v.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This version is locked. Unlock it first.' USING ERRCODE = 'PT423';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION fpa.guard_locked_driver_value() RETURNS trigger LANGUAGE plpgsql SET search_path = fpa, pg_temp AS $$
DECLARE v_scenario uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_scenario := OLD.scenario_id; ELSE v_scenario := NEW.scenario_id; END IF;
  IF EXISTS (SELECT 1 FROM fpa.scenarios s JOIN fpa.plan_versions v ON v.id = s.version_id
              WHERE s.id = v_scenario AND v.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This version is locked. Unlock it first.' USING ERRCODE = 'PT423';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_versions_locked BEFORE UPDATE OR DELETE ON fpa.plan_versions FOR EACH ROW EXECUTE FUNCTION fpa.guard_locked_version();
CREATE TRIGGER scenarios_locked BEFORE INSERT OR UPDATE OR DELETE ON fpa.scenarios FOR EACH ROW EXECUTE FUNCTION fpa.guard_locked_child();
CREATE TRIGGER plan_lines_locked BEFORE INSERT OR UPDATE OR DELETE ON fpa.plan_lines FOR EACH ROW EXECUTE FUNCTION fpa.guard_locked_child();
CREATE TRIGGER packs_locked BEFORE INSERT OR UPDATE OR DELETE ON fpa.packs FOR EACH ROW EXECUTE FUNCTION fpa.guard_locked_child();
CREATE TRIGGER driver_values_locked BEFORE INSERT OR UPDATE OR DELETE ON fpa.driver_values FOR EACH ROW EXECUTE FUNCTION fpa.guard_locked_driver_value();

-- A driver value joins a driver and a scenario of the same plan (so of the same entity).
CREATE FUNCTION fpa.check_driver_value_plan() RETURNS trigger LANGUAGE plpgsql SET search_path = fpa, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fpa.drivers d JOIN fpa.plan_versions v ON v.plan_id = d.plan_id JOIN fpa.scenarios s ON s.version_id = v.id
                  WHERE d.id = NEW.driver_id AND s.id = NEW.scenario_id) THEN
    RAISE EXCEPTION 'The driver and the scenario must belong to the same plan.' USING ERRCODE = 'PT400';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER driver_values_same_plan BEFORE INSERT ON fpa.driver_values FOR EACH ROW EXECUTE FUNCTION fpa.check_driver_value_plan();

-- ── Access helpers ───────────────────────────────────────────────────────────────────────────
-- The one membership check. SECURITY DEFINER so it can read entity_members whatever the caller's
-- own policies are; it only ever answers about the caller (auth.jwt()->>'sub').
CREATE FUNCTION fpa.is_entity_member(p_entity_id uuid, p_min_role text DEFAULT 'viewer') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM fpa.entity_members m
     WHERE m.entity_id = p_entity_id
       AND m.clerk_user_id = (SELECT auth.jwt() ->> 'sub')
       AND m.is_active
       AND CASE m.role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END
           >= CASE p_min_role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 WHEN 'viewer' THEN 1 END);
$$;

-- Internal lookups: which entity a row belongs to. Executable by no API role.
CREATE FUNCTION fpa.plan_entity(p_plan_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT p.entity_id FROM fpa.plans p WHERE p.id = p_plan_id; $$;
CREATE FUNCTION fpa.version_entity(p_version_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT p.entity_id FROM fpa.plan_versions v JOIN fpa.plans p ON p.id = v.plan_id WHERE v.id = p_version_id; $$;
CREATE FUNCTION fpa.scenario_entity(p_scenario_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT p.entity_id FROM fpa.scenarios s JOIN fpa.plan_versions v ON v.id = s.version_id JOIN fpa.plans p ON p.id = v.plan_id
   WHERE s.id = p_scenario_id; $$;
CREATE FUNCTION fpa.driver_entity(p_driver_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT p.entity_id FROM fpa.drivers d JOIN fpa.plans p ON p.id = d.plan_id WHERE d.id = p_driver_id; $$;
CREATE FUNCTION fpa.connection_entity(p_connection_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT c.entity_id FROM fpa.connections c WHERE c.id = p_connection_id; $$;

-- Boolean-only helpers used by the child tables' policies (executable by authenticated). Each
-- answers only "is the caller a member of this row's entity with at least this role".
CREATE FUNCTION fpa.member_for_plan(p_plan_id uuid, p_min_role text DEFAULT 'viewer') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT fpa.is_entity_member(fpa.plan_entity(p_plan_id), p_min_role); $$;
CREATE FUNCTION fpa.member_for_version(p_version_id uuid, p_min_role text DEFAULT 'viewer') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT fpa.is_entity_member(fpa.version_entity(p_version_id), p_min_role); $$;
CREATE FUNCTION fpa.member_for_scenario(p_scenario_id uuid, p_min_role text DEFAULT 'viewer') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT fpa.is_entity_member(fpa.scenario_entity(p_scenario_id), p_min_role); $$;
CREATE FUNCTION fpa.member_for_driver(p_driver_id uuid, p_min_role text DEFAULT 'viewer') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT fpa.is_entity_member(fpa.driver_entity(p_driver_id), p_min_role); $$;
CREATE FUNCTION fpa.member_for_connection(p_connection_id uuid, p_min_role text DEFAULT 'viewer') RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT fpa.is_entity_member(fpa.connection_entity(p_connection_id), p_min_role); $$;
-- VAT rules are reference data: readable by anyone who is an active member of an entity in that
-- jurisdiction.
CREATE FUNCTION fpa.member_in_jurisdiction(p_jurisdiction text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM fpa.entity_members m JOIN fpa.entities e ON e.id = m.entity_id
                  WHERE m.clerk_user_id = (SELECT auth.jwt() ->> 'sub') AND m.is_active AND e.jurisdiction = p_jurisdiction); $$;

-- ── Functions (authenticated) ────────────────────────────────────────────────────────────────
-- Creates an entity, the caller's owner membership and a default plan, in one transaction (any
-- failure undoes all three). A caller may own at most 10 active entities. Calls by the same user
-- are serialised by a transaction-level advisory lock, so two parallel calls cannot both pass the
-- cap.
CREATE FUNCTION fpa.create_entity(p_name text, p_jurisdiction text, p_currency text, p_fiscal_year_start smallint DEFAULT 1)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
DECLARE
  v_sub text := auth.jwt() ->> 'sub';
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
BEGIN
  IF v_sub IS NULL OR v_sub = '' THEN RAISE EXCEPTION 'Please sign in first.' USING ERRCODE = 'PT401'; END IF;
  IF length(v_name) NOT BETWEEN 1 AND 120 THEN RAISE EXCEPTION 'The name must be 1 to 120 characters.' USING ERRCODE = 'PT400'; END IF;
  IF p_jurisdiction IS NULL OR p_jurisdiction NOT IN ('IE', 'UK') THEN RAISE EXCEPTION 'The jurisdiction must be IE or UK.' USING ERRCODE = 'PT400'; END IF;
  IF p_currency IS NULL OR p_currency NOT IN ('EUR', 'GBP') THEN RAISE EXCEPTION 'The currency must be EUR or GBP.' USING ERRCODE = 'PT400'; END IF;
  IF p_fiscal_year_start IS NULL OR p_fiscal_year_start NOT BETWEEN 1 AND 12 THEN
    RAISE EXCEPTION 'The fiscal year must start in a month from 1 to 12.' USING ERRCODE = 'PT400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('fpa.create_entity:' || v_sub, 0));
  IF (SELECT count(*) FROM fpa.entity_members m WHERE m.clerk_user_id = v_sub AND m.role = 'owner' AND m.is_active) >= 10 THEN
    RAISE EXCEPTION 'You already own 10 entities, which is the most allowed.' USING ERRCODE = 'PT429';
  END IF;
  INSERT INTO fpa.entities (name, jurisdiction, currency) VALUES (v_name, p_jurisdiction, p_currency) RETURNING id INTO v_id;
  INSERT INTO fpa.entity_members (entity_id, clerk_user_id, role) VALUES (v_id, v_sub, 'owner');
  INSERT INTO fpa.plans (entity_id, name, fiscal_year_start) VALUES (v_id, 'Main plan', p_fiscal_year_start);
  RETURN v_id;
END $$;

-- Owner-only membership changes. add_member adds a user (or reactivates them with the given role);
-- set_member changes a role or deactivates. An entity always keeps at least one active owner.
CREATE FUNCTION fpa.add_member(p_entity_id uuid, p_clerk_user_id text, p_role text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
BEGIN
  IF NOT fpa.is_entity_member(p_entity_id, 'owner') THEN RAISE EXCEPTION 'Only an owner can add members.' USING ERRCODE = 'PT403'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('owner', 'editor', 'viewer') THEN RAISE EXCEPTION 'The role must be owner, editor or viewer.' USING ERRCODE = 'PT400'; END IF;
  IF p_clerk_user_id IS NULL OR p_clerk_user_id !~ '^user_[A-Za-z0-9]{1,64}$' THEN RAISE EXCEPTION 'That is not a user id.' USING ERRCODE = 'PT400'; END IF;
  INSERT INTO fpa.entity_members (entity_id, clerk_user_id, role) VALUES (p_entity_id, p_clerk_user_id, p_role)
  ON CONFLICT (entity_id, clerk_user_id) DO UPDATE SET role = excluded.role, is_active = true;
END $$;

CREATE FUNCTION fpa.set_member(p_entity_id uuid, p_clerk_user_id text, p_role text, p_is_active boolean)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = fpa, pg_temp AS $$
BEGIN
  IF NOT fpa.is_entity_member(p_entity_id, 'owner') THEN RAISE EXCEPTION 'Only an owner can change members.' USING ERRCODE = 'PT403'; END IF;
  IF p_role IS NULL OR p_role NOT IN ('owner', 'editor', 'viewer') OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'The role must be owner, editor or viewer, and active must be true or false.' USING ERRCODE = 'PT400';
  END IF;
  PERFORM 1 FROM fpa.entities e WHERE e.id = p_entity_id FOR UPDATE;   -- serialise owner changes per entity
  UPDATE fpa.entity_members m SET role = p_role, is_active = p_is_active
   WHERE m.entity_id = p_entity_id AND m.clerk_user_id = p_clerk_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That user is not a member of this entity.' USING ERRCODE = 'PT404'; END IF;
  IF NOT EXISTS (SELECT 1 FROM fpa.entity_members m WHERE m.entity_id = p_entity_id AND m.role = 'owner' AND m.is_active) THEN
    RAISE EXCEPTION 'An entity must keep at least one active owner.' USING ERRCODE = 'PT409';
  END IF;
END $$;

-- ── Row security ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE fpa.schema_migrations ENABLE ROW LEVEL SECURITY;   -- no policies: no API role reads it
ALTER TABLE fpa.entities          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.entity_members    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.connections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.actuals_monthly   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.vat_rules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.plans             ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.plan_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.scenarios         ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.drivers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.driver_values     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.line_map          ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.plan_lines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE fpa.packs             ENABLE ROW LEVEL SECURITY;

CREATE POLICY entities_read ON fpa.entities FOR SELECT TO authenticated USING (fpa.is_entity_member(id, 'viewer'));
CREATE POLICY entities_owner_update ON fpa.entities FOR UPDATE TO authenticated
  USING (fpa.is_entity_member(id, 'owner')) WITH CHECK (fpa.is_entity_member(id, 'owner'));
CREATE POLICY entity_members_read ON fpa.entity_members FOR SELECT TO authenticated USING (fpa.is_entity_member(entity_id, 'viewer'));
CREATE POLICY connections_read ON fpa.connections FOR SELECT TO authenticated USING (fpa.is_entity_member(entity_id, 'viewer'));
CREATE POLICY connections_owner_insert ON fpa.connections FOR INSERT TO authenticated
  WITH CHECK (fpa.is_entity_member(entity_id, 'owner') AND status = 'pending');
CREATE POLICY connections_owner_update ON fpa.connections FOR UPDATE TO authenticated
  USING (fpa.is_entity_member(entity_id, 'owner')) WITH CHECK (fpa.is_entity_member(entity_id, 'owner') AND status IN ('pending', 'disabled'));
CREATE POLICY actuals_monthly_read ON fpa.actuals_monthly FOR SELECT TO authenticated USING (fpa.is_entity_member(entity_id, 'viewer'));
CREATE POLICY vat_rules_read ON fpa.vat_rules FOR SELECT TO authenticated
  USING (verified_at IS NOT NULL AND fpa.member_in_jurisdiction(jurisdiction));

-- Plan data: viewers read; editors and owners insert, update and remove.
CREATE POLICY plans_read ON fpa.plans FOR SELECT TO authenticated USING (fpa.is_entity_member(entity_id, 'viewer'));
CREATE POLICY plans_insert ON fpa.plans FOR INSERT TO authenticated WITH CHECK (fpa.is_entity_member(entity_id, 'editor'));
CREATE POLICY plans_update ON fpa.plans FOR UPDATE TO authenticated
  USING (fpa.is_entity_member(entity_id, 'editor')) WITH CHECK (fpa.is_entity_member(entity_id, 'editor'));
CREATE POLICY plans_remove ON fpa.plans FOR DELETE TO authenticated USING (fpa.is_entity_member(entity_id, 'editor'));

CREATE POLICY plan_versions_read ON fpa.plan_versions FOR SELECT TO authenticated USING (fpa.member_for_plan(plan_id, 'viewer'));
CREATE POLICY plan_versions_insert ON fpa.plan_versions FOR INSERT TO authenticated WITH CHECK (fpa.member_for_plan(plan_id, 'editor'));
CREATE POLICY plan_versions_update ON fpa.plan_versions FOR UPDATE TO authenticated
  USING (fpa.member_for_plan(plan_id, 'editor')) WITH CHECK (fpa.member_for_plan(plan_id, 'editor'));
CREATE POLICY plan_versions_remove ON fpa.plan_versions FOR DELETE TO authenticated USING (fpa.member_for_plan(plan_id, 'editor'));

CREATE POLICY scenarios_read ON fpa.scenarios FOR SELECT TO authenticated USING (fpa.member_for_version(version_id, 'viewer'));
CREATE POLICY scenarios_insert ON fpa.scenarios FOR INSERT TO authenticated WITH CHECK (fpa.member_for_version(version_id, 'editor'));
CREATE POLICY scenarios_update ON fpa.scenarios FOR UPDATE TO authenticated
  USING (fpa.member_for_version(version_id, 'editor')) WITH CHECK (fpa.member_for_version(version_id, 'editor'));
CREATE POLICY scenarios_remove ON fpa.scenarios FOR DELETE TO authenticated USING (fpa.member_for_version(version_id, 'editor'));

CREATE POLICY drivers_read ON fpa.drivers FOR SELECT TO authenticated USING (fpa.member_for_plan(plan_id, 'viewer'));
CREATE POLICY drivers_insert ON fpa.drivers FOR INSERT TO authenticated WITH CHECK (fpa.member_for_plan(plan_id, 'editor'));
CREATE POLICY drivers_update ON fpa.drivers FOR UPDATE TO authenticated
  USING (fpa.member_for_plan(plan_id, 'editor')) WITH CHECK (fpa.member_for_plan(plan_id, 'editor'));
CREATE POLICY drivers_remove ON fpa.drivers FOR DELETE TO authenticated USING (fpa.member_for_plan(plan_id, 'editor'));

-- A driver value needs access to both its driver and its scenario.
CREATE POLICY driver_values_read ON fpa.driver_values FOR SELECT TO authenticated
  USING (fpa.member_for_driver(driver_id, 'viewer') AND fpa.member_for_scenario(scenario_id, 'viewer'));
CREATE POLICY driver_values_insert ON fpa.driver_values FOR INSERT TO authenticated
  WITH CHECK (fpa.member_for_driver(driver_id, 'editor') AND fpa.member_for_scenario(scenario_id, 'editor'));
CREATE POLICY driver_values_update ON fpa.driver_values FOR UPDATE TO authenticated
  USING (fpa.member_for_driver(driver_id, 'editor') AND fpa.member_for_scenario(scenario_id, 'editor'))
  WITH CHECK (fpa.member_for_driver(driver_id, 'editor') AND fpa.member_for_scenario(scenario_id, 'editor'));
CREATE POLICY driver_values_remove ON fpa.driver_values FOR DELETE TO authenticated
  USING (fpa.member_for_driver(driver_id, 'editor') AND fpa.member_for_scenario(scenario_id, 'editor'));

CREATE POLICY line_map_read ON fpa.line_map FOR SELECT TO authenticated USING (fpa.member_for_connection(connection_id, 'viewer'));
CREATE POLICY line_map_insert ON fpa.line_map FOR INSERT TO authenticated WITH CHECK (fpa.member_for_connection(connection_id, 'editor'));
CREATE POLICY line_map_update ON fpa.line_map FOR UPDATE TO authenticated
  USING (fpa.member_for_connection(connection_id, 'editor')) WITH CHECK (fpa.member_for_connection(connection_id, 'editor'));
CREATE POLICY line_map_remove ON fpa.line_map FOR DELETE TO authenticated USING (fpa.member_for_connection(connection_id, 'editor'));

CREATE POLICY plan_lines_read ON fpa.plan_lines FOR SELECT TO authenticated USING (fpa.member_for_version(version_id, 'viewer'));
CREATE POLICY plan_lines_insert ON fpa.plan_lines FOR INSERT TO authenticated WITH CHECK (fpa.member_for_version(version_id, 'editor'));
CREATE POLICY plan_lines_update ON fpa.plan_lines FOR UPDATE TO authenticated
  USING (fpa.member_for_version(version_id, 'editor')) WITH CHECK (fpa.member_for_version(version_id, 'editor'));
CREATE POLICY plan_lines_remove ON fpa.plan_lines FOR DELETE TO authenticated USING (fpa.member_for_version(version_id, 'editor'));

CREATE POLICY packs_read ON fpa.packs FOR SELECT TO authenticated USING (fpa.member_for_version(version_id, 'viewer'));
CREATE POLICY packs_insert ON fpa.packs FOR INSERT TO authenticated WITH CHECK (fpa.member_for_version(version_id, 'editor'));
CREATE POLICY packs_update ON fpa.packs FOR UPDATE TO authenticated
  USING (fpa.member_for_version(version_id, 'editor')) WITH CHECK (fpa.member_for_version(version_id, 'editor'));
CREATE POLICY packs_remove ON fpa.packs FOR DELETE TO authenticated USING (fpa.member_for_version(version_id, 'editor'));

-- ── Grants ───────────────────────────────────────────────────────────────────────────────────
-- Revoke everything first, then grant only what is needed. Parent keys (entity_id, plan_id, ...)
-- are never updatable, so a row cannot be moved to another parent.
REVOKE ALL ON ALL TABLES IN SCHEMA fpa FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fpa FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON fpa.entities, fpa.entity_members, fpa.connections, fpa.actuals_monthly, fpa.vat_rules,
                fpa.plans, fpa.plan_versions, fpa.scenarios, fpa.drivers, fpa.driver_values, fpa.line_map,
                fpa.plan_lines, fpa.packs TO authenticated;
GRANT UPDATE (name, vat_scheme, vat_cycle_anchor) ON fpa.entities TO authenticated;
GRANT INSERT (entity_id, source_type), UPDATE (status) ON fpa.connections TO authenticated;
GRANT INSERT (entity_id, name, fiscal_year_start, horizon_months), UPDATE (name, fiscal_year_start, horizon_months) ON fpa.plans TO authenticated;
GRANT INSERT (plan_id, kind, name, based_on_version_id), UPDATE (name, locked_at) ON fpa.plan_versions TO authenticated;
GRANT INSERT (version_id, name, is_base), UPDATE (name, is_base) ON fpa.scenarios TO authenticated;
GRANT INSERT (plan_id, key, label, unit, kind), UPDATE (label, unit, kind) ON fpa.drivers TO authenticated;
GRANT INSERT (driver_id, scenario_id, period, value), UPDATE (value) ON fpa.driver_values TO authenticated;
GRANT INSERT (connection_id, account_code, plan_line, vat_rate_code), UPDATE (plan_line, vat_rate_code) ON fpa.line_map TO authenticated;
GRANT INSERT (version_id, scenario_id, plan_line, period, amount, origin), UPDATE (amount, origin) ON fpa.plan_lines TO authenticated;
GRANT INSERT (version_id, scenario_id, period, narrative, file_path), UPDATE (narrative, file_path) ON fpa.packs TO authenticated;
GRANT DELETE ON fpa.plans, fpa.plan_versions, fpa.scenarios, fpa.drivers, fpa.driver_values, fpa.line_map,
                fpa.plan_lines, fpa.packs TO authenticated;

-- Membership helpers used by policies, and the three functions the app calls.
GRANT EXECUTE ON FUNCTION fpa.is_entity_member(uuid, text), fpa.member_for_plan(uuid, text), fpa.member_for_version(uuid, text),
                          fpa.member_for_scenario(uuid, text), fpa.member_for_driver(uuid, text), fpa.member_for_connection(uuid, text),
                          fpa.member_in_jurisdiction(text) TO authenticated;
GRANT EXECUTE ON FUNCTION fpa.create_entity(text, text, text, smallint), fpa.add_member(uuid, text, text),
                          fpa.set_member(uuid, text, text, boolean) TO authenticated;
-- Not granted to any API role: plan_entity, version_entity, scenario_entity, driver_entity,
-- connection_entity (lookups), touch_updated_at, guard_locked_version, guard_locked_child,
-- guard_locked_driver_value, check_driver_value_plan (triggers).
