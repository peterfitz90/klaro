# P1-A timing: after the performance fix

25 Nov 2026. **Every timed call is under your 3-second bar. The slowest worst case is the 20,000-row
import, at 1.34 seconds.** Nothing is applied. 0003 waits for your approval of these timings.

## Conditions

- **Role:** `authenticated`, with `SET LOCAL statement_timeout = '8s'`. That matches the role's
  setting on this project: `pg_roles.rolconfig` for `authenticated` is `statement_timeout=8s`.
  `authenticator` also has `lock_timeout=8s`, and `anon` has 3 s.
- **Each call:** its own statement. Each was run 3 times; the worst is reported.
- **Realistic load, all made up:**
  - 50 other entities, each with 200 accounts × 24 months: 240,000 actual rows and 10,000 line-map rows;
  - plus the test entity: 1,500 accounts and 44,000 actual rows;
  - **284,000 actual rows across 51 entities.**
  - The timing user is also a viewer of 5 of the other entities, so the access helper returns several ids.
- **Run:** `db/out/timing_0003.sql` (sha-256 `20aa6b1d3efa8923…`), 25 Nov 2026 at 08:51 UTC, rolled
  back. `scripts/check-sent.mjs` confirmed the text sent was byte-identical to the file.

## Results

| Call | Runs (ms) | Worst | Within 3 s |
|---|---|---|---|
| `import_actuals`: 20,000 rows, 5,025,471 bytes (run 1 loads, runs 2–3 replace all 20 months) | 1,257 / 1,282 / 1,341 | **1,341 ms** | yes |
| `account_map`: 1,500 accounts over 44,000 rows | 168 / 162 / 161 | **168 ms** | yes |
| `unmapped_accounts`: same entity (30 unmapped returned) | 163 / 160 / 160 | **163 ms** | yes |
| `create_budget_from_actuals`: 12-month window, 1,500 mapped accounts, 96 lines | 249 / 196 / 191 | **249 ms** | yes |
| `variance`: 36 months, with a budget, 432 rows | 309 / 303 / 303 | **309 ms** | yes |
| `set_line_map`: 1,470 accounts (setup, for reference) | 488 | 488 ms | yes |

## Before and after

| Call | Before the fix (24 Nov, 1 entity, 44,000 rows) | After (284,000 rows, 51 entities) |
|---|---|---|
| `create_budget_from_actuals` | cancelled at **8 s** | 249 ms |
| `variance`, 36 months | cancelled at **8 s** | 309 ms |
| `account_map` | 1,178 ms | 168 ms |
| `unmapped_accounts` | 1,179 ms | 163 ms |
| Import of 20,000 rows | 2,028 ms | 1,341 ms |

## What the fix was (one attempt, no further tuning)

1. **A new helper, `fpa.my_entity_ids(min_role)`.**
   - It returns only the signed-in user's own active entities at that role or above.
   - It is STABLE and SECURITY DEFINER, with a fixed search_path.
   - Only `authenticated` can run it: not anon, service_role or PUBLIC.
2. **The read policies on `actuals_monthly` and `line_map` use the helper once per query**, inside
   `ARRAY(SELECT …)`, instead of a membership check on every row.
   - The rule is unchanged: active member, viewer or above.
   - There are still 42 policies, all TO authenticated only.
3. **`create_budget_from_actuals` and `variance` read the actuals once**, summed per line and month,
   and build their results with joins instead of per-cell subqueries.

## Proof that nothing changed except speed

From `test_0003.sql` (sha-256 `85e92d0c5e6d5a24…`), byte-checked: **0 failures, 276 passes.**

- **The original 249 checks are unchanged and pass.** They include the 8 shared rounding cases and
  the 20 hand-computed variance cells.
- **The helper, checked for all 9 identities:** owner, editor and viewer of A; an inactive member; a
  non-member; B's owner; anon; service_role; no user id. Each gets only their own entities, at the
  role asked for.
- **Old and new read rules give identical rows for all 9 identities**, on both `actuals_monthly` and
  `line_map`.
  - The test switches the policies back to the Phase 0 definitions, records each identity's row count
    and a hash of its row ids, then switches back and compares.
  - The comparison isn't trivial: owner A sees more than 100 rows, B sees some, the non-member sees
    none, and anon is refused.
- **Old and new functions side by side**, on 200 accounts × 12 months. Test-only copies of the
  original functions live in `fpa_test`.
  - `variance` with 10 unmapped accounts over 24 months: identical.
  - `create_budget_from_actuals` with five different uplifts: identical (96 lines, the same amounts).
  - `variance` with that budget: identical.

**Rollback** (`test_down_0003.sql`, sha-256 `42ba8a6f20b1b318…`): **0 failures, 9 passes**.
- It restores the exact Phase 0 policy text:
  - `fpa.is_entity_member(entity_id, 'viewer'::text)`;
  - `fpa.member_for_connection(connection_id, 'viewer'::text)`.
- It removes the helper.
- The 0001 apply checks pass again afterwards.

**Dry run** (`dryrun_apply_0003.sql`, sha-256 `b9b39f2d30b8cb34…`): **0 failures, 15 passes;
plpgsql_check found nothing in 12 functions.**
- The apply checks now expect the new policy definitions and 27 functions.
- Two new faults are caught: a policy loosened to `true`, and anon allowed to run the helper.

**Read-only check afterwards** (25 Nov):
- Supabase's migration history: **102** rows.
- `fpa.schema_migrations`: 0001 only.
- No 0003 objects, and no `fpa_test`.
- Both read policies back to their Phase 0 text.
- 0 entities and 0 actuals.
- `plpgsql_check` not installed.

## Earlier runs (24 Nov), before the fix

These established the problem: `create_budget_from_actuals` and 36-month `variance` were both
cancelled at 8 seconds, at 44,000 rows. The cause was a membership check on every row, by helpers that
can't be inlined, repeated once per plan line and month.

| Run | File | What happened |
|---|---|---|
| 1 | `2336dd31…` | Aborted at the budget call; its timings were lost with the rollback |
| 2 | `90b5e1fd…` | Aborted at the rebuild step, which hit a missing version I didn't handle |
| 3 | `a291a8ae…` | Gave the figures in "Before and after": import 2.0 s, `account_map` 1.2 s, budget and variance cancelled |
