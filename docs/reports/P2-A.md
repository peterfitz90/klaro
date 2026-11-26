# P2-A: Phase 2A database (0004), built and tested, NOT applied

## Round 2 (26 Nov 2026): `cash_position.cash_accounts`

Status: **waiting for your approval to apply.** 0004 has not been applied.

### Your answers to round 1 (recorded; they shape 2B, not 0004)

- **Cash balance** = cash at the latest month with balances, labelled "Balances through [month]", plus
  "Actuals through [month]" when the two differ.
- **Burn and Runway** show "—" unless balances exist for each of m−3, m−2, m−1 and m.
- **Burning cash with cash at or below zero:** Runway shows 0.0, with the note "Cash is zero or
  overdrawn" under the tile.
- **For 2B, after the apply is approved:**
  - Cash balance and Runway show "—" with "Map your bank accounts to Cash and bank" when
    `cash_accounts` is 0. They never show 0.00 or "n/a" in that state.
  - While any balance account in the latest month is unmapped, the Cash tile says "Incomplete: N
    balance accounts unmapped".
  - The balances import preview warns, and does not block, when an account already mapped to Cash and
    bank has no row in a month of the file. Example: "Account 1200 has no row for Nov 2025; its balance
    will count as 0". This will be tested.

### What changed against the version reviewed in round 1

0004's sha256 went from `37a191a2…6e07` to **`946fd7b686aeeb0515058ab410e14c0fc307011796feb5aff2deb7abea260333`**.
This is the full diff:

1. **`fpa.cash_position`:**
   - **A new output column, `cash_accounts integer`,** placed after `unmapped_accounts`. The returned
     columns are now: latest_month, months_available, unmapped_accounts, **cash_accounts**, month,
     has_balances, cash.
   - **A new CTE, `cash_n`:** it counts the balance rows in the latest month whose account is mapped
     to `cash_bank` (a row is unique per connection, account and month, so this is a count of
     accounts). It is cross-joined like `unm`.
   - **The header comment** explains the column: 0 means "not set up".
   - Nothing else in the function changed: the cash sums, nulls for months never imported, the five
     months, and invoker rights.
2. **Nothing else in 0004 changed.**
   - The `variance` text is unchanged; its 0004 body hash is still `cf5f1382…`.
   - The other functions, grants, policies and the table are unchanged.
3. **`db/apply_checks_0004.sql`:** one new check. `pg_get_function_result(fpa.cash_position(uuid))`
   must equal exactly
   `TABLE(latest_month date, months_available integer, unmapped_accounts integer, cash_accounts integer, month date, has_balances boolean, cash numeric)`.
   If it doesn't, nothing commits. No other check changed.
4. **`db/rollback/0004_down.sql`:** unchanged. It drops `fpa.cash_position(uuid)` by its argument
   list, which didn't change. The rollback bundle is rebuilt because it embeds the new 0004.
5. **`db/tests/0004_down.test.sql`:** the header now says "expect 8 passes", which is correct.
6. **`db/tests/0004_phase2.test.sql`:** 10 new checks, and `cash_accounts` added to every existing cash
   check.
   - The helper's summary line now carries `cash_accounts`, so every cash check asserts it:
     - entity C before mapping: **0**;
     - entity C after mapping: **4**. 1200, 1210, 1220 and 1250 count; 1100 (excluded) and 2200
       (unmapped) don't;
     - entity D, one cash account: **1**;
     - entity A: **1**;
     - a viewer gets the same line as the owner.
   - **New entity E:**
     - every account mapped to excluded, or not mapped: `cash_accounts` **0** with cash 0. "Not set
       up" can now be told apart from zero;
     - then 1200 and 1210 are mapped to Cash and bank, and the count is **1**, because 1210 has no
       row in the latest month. September's cash is 550.00;
     - roles: all 8 tried. Members of other entities, the inactive member and the outsider get no
       rows; anon and service_role are refused (42501).
7. **`docs/reports/P2-0.md`:** the expected-differences list now also has the trigger count (17) and
   the policy count (43), so it is complete.

### Results (all rolled back, every send byte-checked against these files)

| Bundle | sha256 | Result |
|---|---|---|
| `apply_0004.sql` (**the apply bundle**) | `2c721ddd852c3d65…` | not run: it is what gets applied |
| `dryrun_apply_0004.sql` | `46d329e7cc6919f7…` | **0 failures, 15 passes**: the checks pass on the applied state and refuse all 14 injected faults. plpgsql_check: 14 functions, **0 findings** |
| `test_0004.sql` | `14c9af52e5e5f9ad…` | **0 failures, 153 passes** (143 + 10 new) |
| `test_down_0004.sql` | `d52608329cea3326…` | **0 failures, 8 passes** (all of them) |
| `test_0003_on_0004.sql` | `c6d01911f1a262b2…` | 264 passes, 12 failures. Exactly the 12 now listed in P2-0, with the same messages as round 1; no Phase 1 behaviour check failed |
| `timing_0004.sql` | `15bdbd85ede11ab1…` | every call under 8 s (below) |

**Grants evidence:** `db/tests/GRANTS_EVIDENCE_0004.txt` was regenerated from this run. It is the same
line for line as round 1; only the pass count changed.

**Timings** (worst of 3, as `authenticated` under the 8 s timeout; 54 entities, 260,000 balance rows,
275,193 actual rows):

| Call | Round 2 | Round 1 |
|---|---|---|
| `import_balances` (20,000 rows) | 2,873 ms | 1,447 ms |
| `balance_accounts` | 266 ms | 159 ms |
| `cash_position` | 61 ms | 47 ms |
| `save_budget_lines` (1,200 lines) | 2,359 ms | 2,395 ms |
| `variance` | 179 ms | 155 ms |

The import is the same code as in round 1, so the slower time is load on the shared database between
runs; its three runs were 2,418, 2,114 and 2,873 ms. The slowest call is still about a third of the
limit. `cash_position`, the only function that changed, is still under 0.1 s.

**Connector confirmations this round:** the connector asked for confirmation on `test_0004.sql`, not on
the rollback test. The first request expired with nothing run, and the second ran. The rollback test
ran without a prompt.

**Database after testing** (read-only check, 26 Nov):
- Supabase migration history: **102**.
- `fpa.schema_migrations`: 0001 and 0003 only.
- No `balances_monthly` table and no `fpa_test` schema.
- 13 plan lines and 27 functions.
- The `variance` hash is still the applied 0003 one (`e2f4425c…`).
- Nothing was deleted.

### For you to decide

**Approve applying 0004?** If yes, I send `db/out/apply_0004.sql` (sha256 `2c721ddd852c3d65…`) exactly,
then:
- the byte-check;
- the read-only after-check: history still 102; three rows in `schema_migrations` with matching
  checksums; function hashes match the repo;
- the anon-key smoke test, reported in `P2-A-smoke.md`.

After that I'll stop again before 2B.

---

## Round 1 (25 Nov 2026), as reviewed

The sections below are the round-1 report, kept as reviewed. Its sha256 values and results are
superseded by round 2 above. Its questions are answered.

Date: 25 Nov 2026. Branch: `phase-2`.
Every run below was a rolled-back transaction, sent through the Supabase connector as the exact text of
a file in `db/out/`. The byte-check (`scripts/check-sent.mjs`) confirms each send matched its file's
sha256.

## What 0004 adds

The proposals were set out in `docs/reports/P2-0.md`.

- **A new plan line, "Cash and bank"** (`cash_bank`):
  - kind `balance`, sort 140, display sign +1;
  - mappable, but not budgetable;
  - never in a profit line, never in Compare (variance), never in the excluded total.
- **`fpa.balances_monthly`:** closing (month-end) balances, stored in trial-balance sign, exact cents
  (numeric(14,2)).
  - Row security: viewers and above can read.
  - No API role can write to the table directly.
- **`sync_runs.kind`:** `actuals` (the default, so `import_actuals` is unchanged) or `balances`.
- **`fpa.import_balances`** (SECURITY DEFINER; editor or owner):
  - replaces each month in the file completely, in one transaction;
  - writes a `sync_runs` row of kind `balances`;
  - limits: 20,000 rows and 5 MB;
  - leaves the connection's "actuals through" and "last synced" alone.
- **`fpa.balance_accounts`** (invoker): the balance accounts for the mapping screen, unmapped first.
- **`fpa.cash_position`** (invoker): the inputs only. It returns the latest month with balances and
  the cash at it and at the four month-ends before it (null for a month that was never imported, never
  zero), the number of months with balances, and the number of unmapped accounts. Burn and runway will
  be worked out in `src/engine` in 2B.
- **`fpa.save_budget_lines`** (invoker; editor or owner): saves hand edits all-or-nothing.
  - Refuses a locked version (PT423).
  - Refuses a line from another version, a non-base scenario or another entity, a line that doesn't
    exist, a bad amount, a duplicate, or more than 1,200 lines.
- **`fpa.variance`:** the applied 0003 text with one change: `kind <> 'excluded'` becomes
  `kind NOT IN ('excluded','balance')`. `db/bundle.mjs` refuses to build if anything else differs.

## Files

| File | Purpose |
|---|---|
| `db/migrations/0004_fpa_balances_cash.sql` | the migration (sha256 `37a191a2…6e07`) |
| `db/apply_checks_0004.sql` | assertions run before COMMIT; any mismatch raises and nothing is kept |
| `db/rollback/0004_down.sql` | restores the exact 0003 state; needs a typed confirmation, plus a second one if balances exist |
| `db/tests/0004_phase2.test.sql` | the Phase 2 test |
| `db/tests/0004_down.test.sql` | the rollback test |
| `db/tests/apply_dryrun_0004.test.sql` | the apply checks against 14 injected faults, plus plpgsql_check |
| `db/tests/0004_timing.test.sql` | timings as `authenticated` under the 8 s timeout |
| `db/tests/GRANTS_EVIDENCE_0004.txt` | the privilege report |
| `db/out/apply_0004.sql` | **the apply bundle** (sha256 `8727202301ba74ea…`): BEGIN; 0004; the schema_migrations row; the apply checks; COMMIT |

## Results

| Bundle (sha256, first 16) | Result |
|---|---|
| `test_0004.sql` (`9b0a358cf784d1d8`) | **0 failures, 143 passes** |
| `dryrun_apply_0004.sql` (`2624f31fdf001081`) | **0 failures, 15 passes**: every injected fault made the checks refuse. plpgsql_check: 14 functions, **0 findings** |
| `test_down_0004.sql` (`12fe9bc7b0e1fd28`) | **0 failures, 8 passes**: refuses without the confirmation, refuses again if balance data exists, then restores 0003 exactly (the apply checks for 0003 pass and the variance body hash matches) and leaves Ledgrly's tables alone |
| `test_0003_on_0004.sql` (`292142be62b6d16f`) | 264 passes, 12 failures, all of them structural counts (see below). No Phase 1 behaviour check failed. |
| `timing_0004.sql` (`faa79a526f17d460`) | every call under the 8 s limit (see below) |

### What the Phase 2 test covers (143 checks)

- **Roles:** every action as owner, editor, viewer, inactive member, outsider, another entity's owner,
  anon and service_role.
- **Cross-entity:** each entity's connection used through the other entity, and each entity's budget
  saved by the other entity's members. All refused.
- **Imports:**
  - whole-month replace, checked to the cent;
  - the sync kind;
  - the connection row and P&L actuals untouched.
- **Atomicity:** an injected failure at the sync-log write, and another midway through the inserts.
  Both put the replaced months back exactly and log nothing.
- **Limits:**
  - 20,001 rows refused; exactly 20,000 accepted;
  - more than 5 MB refused;
  - 14 kinds of bad input refused, and the error names the row.
- **Cash against a hand-computed table** (the table is in the test file, entity C, Jun–Oct 2025):

  | Month | Cash |
  |---|---|
  | Jun | 14,550.00 |
  | Jul | 13,640.00 |
  | Aug | 12,200.50 |
  | Sep | 10,830.25 |
  | Oct | 9,725.00 |

  These figures cover:
  - an overdraft lowering cash;
  - excluded and unmapped accounts not counted;
  - a cash account with no row in a month counting as 0;
  - a never-imported month giving null, not 0;
  - before any mapping, cash showing 0 with 6 accounts unmapped.
- **Variance:** no Cash and bank line. The result equals the 0003 output less its Cash and bank rows;
  net profit is unchanged.
- **The budget save:**
  - the role matrix;
  - a good save;
  - 11 refusals, each saving nothing anywhere, including a line from another version;
  - locked → PT423; an editor still can't unlock.
- **Privileges:** see `GRANTS_EVIDENCE_0004.txt`.
  - The new functions are executable by `authenticated` only (not PUBLIC, anon or service_role).
  - `balances_monthly`: SELECT for `authenticated` only.
  - 17 tables, all with row security; 43 policies, all TO authenticated; 31 functions.
  - No foreign key leaves `fpa`.

The first run had **6 failures, all in the test, not in 0004**, and I fixed them:
- Five compared booleans as `true` and `false`, but `format('%s')` prints `t` and `f`. The cash
  figures themselves were already right.
- One expected the 0003 and new variance to be identical when no account is on Cash and bank. They
  aren't: the 0003 text keeps every line that isn't `excluded`, so it shows a zero Cash and bank line.
  The test now checks exactly that.

The migration was not changed.

### The Phase 1 suite on top of 0004: the 12 failures

**Ten were listed in advance** in P2-0 item 12:
- "plan_line_defs holds exactly the agreed list": `cash_bank` is now the 14th line;
- the six "plan_line_defs read as …" checks: 14, not 13;
- "all 16 tables have row security enabled": now 17;
- the two "variance, new and old, identical" checks:
  - The Phase 1 test's own copy of the pre-0003 variance adds a zero Cash and bank line.
  - I added these two to P2-0 before this run, when the Phase 2 test showed the same effect.

**Two were not listed in advance.** Both are caused by the new table, and I should have listed them:
- "every table has its updated_at trigger" counts exactly 16; `balances_monthly` brings its own trigger,
  so the count is 17.
- "still 42 policies" is now 43, because of `balances_monthly_read`.

The Phase 2 test checks 17 tables and 43 policies directly. I have not edited the Phase 1 test.

### Timings

The run used 54 entities: 50 extra ones, each with 4,800 actual and 4,800 balance rows, giving
260,000 balance rows and 275,193 actual rows. Calls ran as `authenticated` with an 8 s timeout.

| Call | Worst of 3 |
|---|---|
| `import_balances`: 20,000 rows, about 5 MB (load, then two full replaces) | 1,447 ms |
| `balance_accounts`: 1,000 accounts, 20,000 rows | 159 ms |
| `cash_position`: 20,000 rows, 10 cash accounts | 47 ms |
| `save_budget_lines`: 1,200 lines (the maximum) | **2,395 ms** |
| `variance` (replaced): 20 months, 1,000 accounts, 10 on Cash and bank | 155 ms |

`set_line_map` took 746 ms for 2,000 accounts; that call was untimed setup. No call was cancelled.

`save_budget_lines` is the slowest call. That is probably the per-line lock and `updated_at` triggers
on `plan_lines`. 2.4 s is a third of the limit at the maximum size; a normal edit is a few lines. I'm
not changing it; I'll watch it in 2B.

## Database state after testing (read-only check)

- Supabase migration history: **102** (unchanged).
- `fpa.schema_migrations`: 0001 and 0003 only.
- No `balances_monthly` table, no `sync_runs.kind` column, no `fpa_test` schema.
- 13 plan lines and 27 functions, as before.
- The `variance` body hash is still the 0003 one (`e2f4425c…`).
- Nothing was deleted, and the test data ("test 1", "Walkthrough Test 1", "Walkthrough Test 2") is
  untouched.

## Small notes

- The rollback test's header says "expect 9 passes", but it has 8 scoring checks, so 8 of 8 is a full
  pass. I'll correct the comment in the next change to that file. I haven't edited it now, so the file
  still matches what was sent.
- The rollback test's run needed your confirmation in the connector. The first request expired after
  10 minutes; the second ran.

## For you to decide

1. **Approve applying 0004?** If yes, I send `db/out/apply_0004.sql` exactly. Then:
   - the byte-check;
   - the read-only after-check: history still 102, three rows in `schema_migrations`, checksums
     match;
   - the anon-key smoke test.
2. **P2-0 item 4:** the Cash balance at the **latest month with balances**, labelled "Balances through
   [month]" (plus "Actuals through [month]" when the two differ). Or keep "latest month of actuals",
   which shows "—" until balances reach that month?
3. **P2-0 item 5:** burn and Runway show "—" unless balances exist for **each** of m−3, m−2, m−1 and
   m, four in a row, rather than any four month-ends. `cash_position` returns five months, so it
   supports either rule.
4. **P2-0 item 6:** when burning cash with cash at or below zero, Runway shows **0.0**. Confirm?

Items 2 to 4 only affect 2B (the engine and the screen); 0004 is the same either way.

I'm stopping here. I won't apply 0004 or start the 2A/2B screens until you approve.
