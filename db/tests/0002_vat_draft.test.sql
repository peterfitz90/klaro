-- Rolled-back test of the DRAFT 0002 (VAT rules). db/bundle.mjs builds db/out/test_0002_draft.sql:
-- BEGIN; 0001; 0002 DRAFT; this file. It is never part of an apply. Ends by raising its result, so
-- everything rolls back. Expect "0 failure(s), 5 pass(es)".
DO $t$
DECLARE v_f text[] := '{}'; v_p int := 0; v_n bigint;
BEGIN
  -- 1. It loaded 9 rows, every one unverified.
  IF (SELECT count(*) FROM fpa.vat_rules) = 9 AND NOT EXISTS (SELECT 1 FROM fpa.vat_rules WHERE verified_at IS NOT NULL) THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'expected 9 unverified rows'::text; END IF;
  -- 2. Each jurisdiction has rates and one filing rule.
  IF (SELECT count(*) FROM fpa.vat_rules WHERE jurisdiction = 'IE' AND rate IS NOT NULL) = 4
     AND (SELECT count(*) FROM fpa.vat_rules WHERE jurisdiction = 'UK' AND rate IS NOT NULL) = 3
     AND (SELECT count(*) FROM fpa.vat_rules WHERE jurisdiction = 'IE' AND filing_frequency IS NOT NULL) = 1
     AND (SELECT count(*) FROM fpa.vat_rules WHERE jurisdiction = 'UK' AND filing_frequency IS NOT NULL) = 1 THEN v_p := v_p + 1;
  ELSE v_f := v_f || 'each jurisdiction needs exactly one filing rule'::text; END IF;
  -- 3. Unverified rows are invisible to a signed-in member (fails closed until Peter verifies them).
  INSERT INTO fpa.entities (id, name, jurisdiction, currency) VALUES ('00000000-0000-4000-8000-000000000001', 'Draft Test Ltd', 'IE', 'EUR');
  INSERT INTO fpa.entity_members (entity_id, clerk_user_id, role) VALUES ('00000000-0000-4000-8000-000000000001', 'user_draftTest', 'owner');
  PERFORM set_config('request.jwt.claims', '{"sub":"user_draftTest","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM fpa.vat_rules;
  RESET ROLE;
  IF v_n = 0 THEN v_p := v_p + 1; ELSE v_f := v_f || format('a member saw %s unverified rows', v_n); END IF;
  -- 4. Once verified (with a source), the member sees its jurisdiction's rows only.
  UPDATE fpa.vat_rules SET verified_at = now(), source_url = 'https://example.invalid/test';
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM fpa.vat_rules;
  RESET ROLE;
  IF v_n = 5 THEN v_p := v_p + 1; ELSE v_f := v_f || format('a verified IE member saw %s rows, expected 5', v_n); END IF;
  -- 5. The apply checks would refuse to commit with VAT rules present (0002 never rides along).
  IF EXISTS (SELECT 1 FROM fpa.vat_rules) THEN v_p := v_p + 1; END IF;
  RAISE EXCEPTION '% failure(s), % pass(es) %', coalesce(array_length(v_f, 1), 0), v_p, array_to_string(v_f, ' | ');
END $t$;
