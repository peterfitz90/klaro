-- 0002 (DRAFT): Irish and UK VAT rates and filing rules. NEVER APPLIED TO PRODUCTION as it stands.
-- db/bundle.mjs and db/migrate-lib.mjs skip every *_DRAFT.sql file, and db/apply_checks.sql refuses
-- to commit if any VAT rule exists.
--
-- Every row has verified_at NULL, so the app cannot see it (fpa.vat_rules is readable only where
-- verified_at is set). Peter must check each rate and due-date rule against Revenue (revenue.ie) and
-- GOV.UK first. The figures below are reference points to check, NOT to trust. Once checked, this
-- becomes a new numbered migration (no _DRAFT) that sets verified_at and the exact source_url per row.
--
-- rate is a percentage; a filing-rule row has rate NULL and a filing_frequency with due_day_rule.
-- effective_from is a placeholder (2025-01-01) until each row's real start date is confirmed.

INSERT INTO fpa.vat_rules (jurisdiction, rate_code, rate, filing_frequency, due_day_rule, effective_from, verified_at, source_url) VALUES
  -- Ireland: rates (to check against Revenue's VAT rates database).
  ('IE', 'IE_STANDARD',  23.00, NULL, NULL, '2025-01-01', NULL, NULL),
  ('IE', 'IE_REDUCED',   13.50, NULL, NULL, '2025-01-01', NULL, NULL),
  ('IE', 'IE_SECOND_REDUCED', 9.00, NULL, NULL, '2025-01-01', NULL, NULL),
  ('IE', 'IE_ZERO',       0.00, NULL, NULL, '2025-01-01', NULL, NULL),
  -- Ireland: filing. Bi-monthly returns; due the 19th of the month after the period, or the 23rd for
  -- ROS filers who also pay through ROS (to check, including the annual and other frequencies).
  ('IE', 'IE_FILING_BIMONTHLY', NULL, 'bi_monthly', 'Day 19 of the month after the period ends; day 23 when filed and paid through ROS', '2025-01-01', NULL, NULL),
  -- UK: rates (to check against GOV.UK VAT rates).
  ('UK', 'UK_STANDARD',  20.00, NULL, NULL, '2025-01-01', NULL, NULL),
  ('UK', 'UK_REDUCED',    5.00, NULL, NULL, '2025-01-01', NULL, NULL),
  ('UK', 'UK_ZERO',       0.00, NULL, NULL, '2025-01-01', NULL, NULL),
  -- UK: filing. Quarterly returns; due one calendar month and seven days after the period ends (to check).
  ('UK', 'UK_FILING_QUARTERLY', NULL, 'quarterly', 'One calendar month and 7 days after the period ends', '2025-01-01', NULL, NULL);
