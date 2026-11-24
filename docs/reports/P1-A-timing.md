# P1-A timing: STOPPED before apply

24 Nov 2026. **Two functions take more than 8 seconds at the agreed limits: `create_budget_from_actuals`
and `variance` over 36 months. Both are far over your 3-second bar, so 0003 is not applied.** Every
other function runs in at most 2.0 seconds.

## Role timeouts on this project (read-only check of `pg_roles.rolconfig`)

| Role | Setting |
|---|---|
| `authenticated` | `statement_timeout=8s` (as you thought) |
| `authenticator` | `statement_timeout=8s`, `lock_timeout=8s`, and the `safeupdate` library. That library blocks DELETE and UPDATE without a WHERE clause; every DELETE in 0003 has one |
| `anon` | `statement_timeout=3s` |
| `service_role` | none |

## Timings

**How it was run:**
- The file was `db/out/timing_0003.sql` (sha `a291a8ae…`), rolled back.
- Each call ran as `authenticated`, with `SET LOCAL statement_timeout = '8s'`, as its own statement.
- Run on 24 Nov 2026 at 15:18 UTC; `scripts/check-sent.mjs` confirmed the text sent matched the file byte for byte.

**The data, all made up:**
- one entity;
- 1,500 accounts;
- 44,000 actual rows over 36 months (2022-09 to 2025-08);
- all 1,500 accounts mapped.

| Call | Time | Within 3 s? |
|---|---|---|
| `import_actuals`, 20,000 rows, 5,025,471 bytes, first load | 2,028 ms | yes |
| `import_actuals`, the same 20,000 rows again (deletes 20,000, inserts 20,000) | 1,901 ms | yes |
| `import_actuals`, 18,000 rows | 1,106 ms | yes |
| `import_actuals`, 6,000 rows | 318 ms | yes |
| `set_line_map`, 1,500 accounts | 778 ms | yes |
| `account_map`, 1,500 accounts over 44,000 rows | 1,178 ms | yes |
| `unmapped_accounts`, same entity | 1,179 ms | yes |
| **`create_budget_from_actuals`**, 12-month window, 1,500 mapped accounts | **> 8,000 ms (cancelled)** | **no** |
| **`variance`**, 36 months (run without a budget, because the budget call was cancelled) | **> 8,000 ms (cancelled)** | **no** |
| `create_budget_from_actuals`, rebuild | not run (no version to rebuild) | — |

**Earlier runs:**
- `2336dd31…` aborted at the budget call, and its timings were lost with the rollback.
- `90b5e1fd…` aborted at the rebuild step, which hit a missing version I didn't handle.
- `a291a8ae…`: the first attempt was declined; the re-run you approved produced the table above.

## Cause

**Row security checks every row, and each check is a separate query.** The functions run as the
caller, so row security checks each row they read. The checks call SECURITY DEFINER helpers
(`is_entity_member`, `member_for_connection` → `connection_entity`). Postgres can't inline those, so
every check is its own small query.
- A single pass over all 44,000 rows costs about 1.2 seconds (`account_map`).

**The two slow functions read the same rows many times:**
- `create_budget_from_actuals` sums the actuals in a subquery once per plan line and month (8 × 12 = 96 times). Each pass pays the per-row check again.
- `variance` builds its 12 lines × 36 months grid from the summed actuals. The plan has to be checked, but the likely cause is the same: the per-month subqueries re-scan the summed actuals and line map once per cell.

## Proposed fix (needs your OK: it changes 0003 and the read policy on two Phase 0 tables)

1. **Check membership once per query, not once per row.**
   - A new SECURITY DEFINER helper, `fpa.my_entity_ids(min_role)`, returns the caller's active entity ids.
   - The read policies on `actuals_monthly` and `line_map` would use
     `entity_id = ANY (ARRAY(SELECT fpa.my_entity_ids('viewer')))`. Postgres evaluates that list once per query.
   - This is the pattern Supabase recommends for faster row security. The access rule is the same: active membership, viewer or above.
   - For `line_map`, the check goes through its connection's entity.
   - It is done with `ALTER POLICY` inside 0003, so nothing is dropped. The rollback restores the Phase 0 policies.
2. **Read once in both slow functions.**
   - In `create_budget_from_actuals` and `variance`, add up the mapped actuals once into a grouped result (line × month).
   - Build the grid with joins instead of per-cell subqueries.
   - The results don't change. The variance figures and rounding cases are already pinned by the tests.
3. **Re-run, then report.**
   - Re-run all four bundles: the test, the dry run, the rollback test and this timing run.
   - Report every timing against the 3-second bar.
   - Apply only with your OK.

## Not done (blocked on this)

- The apply.
- The anon smoke test (`P1-A-smoke.md`).
