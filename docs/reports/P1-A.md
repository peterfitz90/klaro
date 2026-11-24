# P1-A: database for Phase 1, built and tested (review stop)

24 Nov 2026, branch `phase-1`. **Nothing is applied.** All three rolled-back runs passed on the exact
bundle files. This is the 1A review stop. With your approval I'll apply `db/out/apply_0003.sql` the
way B3 was done, then run the read-only checks and an anonymous-key request against the new
functions, and stop.

First, please decide the three points in `P1-0.md` B1 to B3:
1. the display sign on the plan line;
2. the extra "Not in the P&L (excluded)" line;
3. the migration-numbering change.

Please also look at `docs/kpi-definitions.md`, which is a draft for your sign-off.

## Results (rolled back, byte-checked)

Every run was sent through the connector as plain SQL, unstripped. `scripts/check-sent.mjs` confirmed
each text was byte-identical to its file.

| Run (24 Nov, UTC) | File (sha-256, first 16) | Result |
|---|---|---|
| 13:00 | `dryrun_apply_0003.sql` (`4082a2841b0922e0`) | Confirmation expired; nothing ran |
| 14:30 | `dryrun_apply_0003.sql` (`4082a2841b0922e0`) | **0 failures, 13 passes; plpgsql_check: 12 PL/pgSQL functions, 0 findings** |
| 14:35 | earlier `test_0003.sql` (`d034048768ec1568`) | 1 failure, 248 passes. The failing check was a test bug: it read B's actuals as editor A, and row security correctly hid them. Fixed by reading as the table owner; not counted |
| 14:42 | `test_0003.sql` (`0ada9978ea0c9a7a`) | **0 failures, 249 passes** |
| 14:47 | `test_down_0003.sql` (`5c44c652fcf9fdfc`) | **0 failures, 8 passes** |

**Read-only check afterwards:**
- Supabase's migration history: **102** rows.
- `fpa.schema_migrations`: only 0001.
- No `plan_line_defs`, `sync_runs` or `fpa_test`.
- 20 functions and 40 policies, as before.
- 0 entities and 0 actuals.
- The origin check is unchanged.
- `plpgsql_check` is not installed.
- None of the new columns exist.

**Grants evidence:** `db/tests/GRANTS_EVIDENCE_0003.txt`, uncut.
- No fpa function can be run by PUBLIC, anon or service_role.
- Only `import_actuals` runs with owner rights (SECURITY DEFINER).
- The five other new functions run as the caller (SECURITY INVOKER).

## What the 249 checks cover

**Identities.** Every matrix runs as each of these:
- owner, editor and viewer of entity A;
- an inactive member;
- a non-member;
- the owner of entity B;
- anon and service_role.
- There is also a signed-in caller with no user id.

| Area | What is proved |
|---|---|
| Plan-line list | Exactly the agreed 13 rows, with signs and kinds. Every signed-in user can read it; anon and service_role get 42501. Nobody can update or insert |
| `import_actuals` permissions | Owner and editor succeed. Viewer, inactive member, non-member and B's owner get PT403; anon and service_role get 42501; no user id gets PT401 |
| Cross-entity | Each of these is refused: B's owner using A's connection through B's entity (PT404); A's owner using B's connection (PT404); B mapping A's accounts (PT403); B reading A's version through B's entity (PT404); B writing into A's version through B's plan (PT404). A editor sees none of B's accounts, and B's own variance shows only B's actuals. A's imports never touch B's rows |
| Whole-month replace | First import: 18 rows over 3 months. Re-importing February and April: January and March are untouched, February is replaced exactly (two accounts gone, one changed), April is added, 6 rows removed and 6 added. The connection's synced time and "through" month are set. `sync_runs` logs who, the file, the months, the counts and the status |
| Atomicity | An injected failure at the last step (the sync log), and another midway through the inserts. Each time the error reaches the caller, and deleted months come back exactly: same row count and sum, nothing logged, sync fields unchanged |
| Limits and bad input | 31 cases refused with the right code: 20,001 rows and more than 5 MB give PT413; NaN, Infinity, three decimals, 1e20, months out of range or mid-month, duplicates, unknown fields, a non-CSV or disabled connection and others give PT400 or PT409. Exactly 20,000 rows is accepted. Errors name the row ("Row 2: the amount …"). Nothing changes after any refusal |
| Direct writes | Actuals and `sync_runs` can't be written directly by any role. `sync_runs` reads follow membership (2, 2, 2, 0, 0, 1, then 42501 for anon and service_role) |
| Line map | Permissions as for import. Refused: a calculated line, Unmapped, a made-up line, wrong types, duplicates. The foreign key also stops direct inserts of bad lines (23503). Counts for added, changed and removed are right. `account_map` lists unmapped accounts first with names from the latest month; `unmapped_accounts` returns exactly the one unmapped account. Non-members get no rows |
| Variance | **20 hand-computed cells match.** They include a zero budget (percent null and favourable true), an unmapped account (its own line, not in profit), Gross, Operating and Net profit, a budget-only month, an actuals-only month (budget null) and a month with no data at all (all null). It returns 12 lines × 5 months; Excluded is left out; a non-base scenario is ignored; with no version every budget is null. Viewers can read; non-members get PT404. A range over 36 months, a mid-month date and a reversed range are refused; exactly 36 months returns 432 rows |
| Budget from actuals | **The 8 shared rounding cases match** the fixture worked out independently in Python, and each sums exactly to its annual figure. They include a last month that goes negative (−0.04) to absorb leftover cents, exact half cents both ways, −100% and a large credit. 96 lines, origin `from_actuals`, base scenario. Refused: unmapped accounts in the window (named), a month missing, 8 kinds of bad uplift, a forecast version, another plan's version, non-editors |
| Locks | An editor locks; the budget function then refuses the version (PT423); its lines can't be edited (PT423). A viewer can't unlock (no row) and an editor can't (PT403): **the Phase 0 owner-only rule still holds**. Once an owner unlocks, rebuilding replaces the 12 months without duplicating them |
| Structure | 16 tables, all with row security and an updated_at trigger. No float or money columns. No foreign key leaves fpa. Schema usage is unchanged: authenticated only |
| Dry run | `apply_checks_0003.sql` passes on the applied state and catches all 12 faults tried, among them an anon grant, a PUBLIC execute on a helper, an extra policy, a function switched to SECURITY DEFINER, a changed plan-line sign and a wrong checksum |
| Rollback | It refuses without confirmation, with budget lines from actuals present, and with sync data present unless confirmed. Once confirmed, the schema is back to exactly the post-0001 state (the 0001 apply checks pass again). Actuals, plans and lines are kept, and nothing outside fpa changes |

## Files

| File | sha-256 |
|---|---|
| `db/migrations/0003_fpa_actuals_budget_variance.sql` | `c7a3480cf6321fefe9cb3c55d82129a0ed243a77fe1cbaa26b5434e4df5e43de` |
| `db/out/apply_0003.sql` (to be applied) | `34a4dec5d3826426…` |
| `db/out/dryrun_apply_0003.sql` | `4082a2841b0922e0…` |
| `db/out/test_0003.sql` | `0ada9978ea0c9a7a…` |
| `db/out/test_down_0003.sql` | `5c44c652fcf9fdfc…` |
| Phase 0 bundles | Rebuild byte-identical: `6a6499d4`, `2c43b22f`, `61355a94`, `733fbb60`, `617f8d9c` |

Other files:
- `db/apply_checks_0003.sql`
- `db/rollback/0003_down.sql`
- `db/tests/0003_phase1.test.sql`
- `db/tests/0003_down.test.sql`
- `db/tests/apply_dryrun_0003.test.sql`
- `db/tests/fixtures/rounding_cases.json`
- `db/tests/GRANTS_EVIDENCE_0003.txt`
- `src/engine/rounding.ts` and its tests (37)

## The apply, when you approve

1. Read-only pre-check: migration history 102, `fpa.schema_migrations` holding only 0001, and 0
   entities.
2. Send `db/out/apply_0003.sql` exactly, as plain SQL in one transaction. Its assertions run before
   `COMMIT`. The connector will ask for your confirmation.
3. Byte-check what was sent.
4. Read-only check after: the apply checks pass again, the 0003 checksum is in
   `fpa.schema_migrations`, the migration history is still 102, and the function body hashes match
   the repo.
5. A request with the anonymous key to each of the six new functions must be refused. Save the
   responses to `docs/reports/P1-A-smoke.md`.
6. Stop.

## Ledgrly untouched

- `finflow-deploy` is unchanged at `51c5f24`.
- Every statement in these runs targets `fpa` or `fpa_test`.
- The rollback test only checks that `public.journals` still exists. It doesn't change it.
