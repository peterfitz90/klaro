# Klaro Phase 1: final report (Gate 1 review stop)

25 Nov 2026, branch `phase-1`, draft PR #1. **Stopped for your Gate 1 review.**
- **Not done:**
  - nothing is merged to main;
  - Phase 2 is not started;
  - no test data is deleted.
- **Database:** one migration was applied in Phase 1, 0003, on 25 Nov 2026 at 09:03:33 UTC. Nothing
  else changed in the database.
- **KPI strip:** live since your sign-off, for Phase 1 only.

## 1. What was done, step by step

| Step | What | Evidence |
|---|---|---|
| P1-0 | Reviewed the Phase 0 plan against your Phase 1 decisions. Three points came to you: the display sign on the plan-line list, the extra "excluded" line, and the migration numbering | `P1-0.md` |
| 1A | 0003 built and tested in rolled-back runs (249 checks). Timing at the limits showed two calls over 8 s, so I stopped. One performance fix, approved by you, with old-versus-new equivalence proved (276 checks). Applied with your OK, byte-checked, read-only checks after, anonymous-key smoke test | `P1-A.md`, `P1-A-timing.md`, `P1-A-smoke.md` |
| 1B | CSV import on Connect: column matching, the two questions, browser checks, preview, import, result, readable error list. € / £ signs and brackets added at your request | `P1-C.md` |
| 1C | Account mapping: paged reads, unmapped first, "Mapping complete", excluded count and total, suggestions you apply yourself. Walk-through on the preview; **closed by you 25 Nov** | `P1-C.md` (results from the database and gateway logs) |
| 1D | Budget from actuals on Plan: window, uplift per line, preview, create, rebuild warning with explicit yes, hand edits, lock and unlock | `P1-E.md` |
| 1E | Compare from `fpa.variance`; KPI strip wired, then **switched on after your sign-off** (25 Nov, Phase 1 only); phone width checked | `P1-E.md`, section 7 below |
| Gate 1 | This report; the proposed clean-up script (not run) | `db/ops/PROPOSED_2026-11-25_delete_phase1_test_data.sql` |

**Commits on phase-1** (oldest first):
- `abf8cc1`, `a4acb5e`, `a6bc71f`, `162eb71`, `bddea41`, `5b65e34`: 1A;
- `cfe3243`: apply and smoke test;
- `b8fd733`, `ba1d562`, `254019f`, `51928f4`: 1B and 1C;
- `79b7801`, `db94239`: 1D and 1E;
- `83ac6b8`: KPI strip on, and the 96-line correction;
- the Gate 1 commit, which adds this report and Compare's "last synced", described below.

## 2. Gate 1 checklist

| Gate 1 item | Status | Evidence |
|---|---|---|
| Migrations applied as plain SQL with assertions; checksums in `fpa.schema_migrations` match the repo; Supabase migration history unchanged | **Met** | `P1-A-smoke.md`: `apply_0003.sql` (`02d2c24a…`) sent byte-identically in one transaction, with the apply checks before `COMMIT`. **Re-checked for this report (25 Nov, read-only):** `fpa.schema_migrations` holds 0001 (`afacaac2…`) and 0003 (`5ae7ea50a80405112989d1f6346cae3d3ee446cd293d91686c2ba800b75a91ba`); the repo file hashes to the same value; Supabase history is **102** rows |
| Row security, grants and function privileges verified as every role; the cross-entity test covers all new functions | **Met** | Section 3 below; `db/tests/GRANTS_EVIDENCE_0003.txt` |
| CSV import atomic and whole-month replacing, with evidence | **Met** | Database tests: an injected failure at the last step and another midway; deleted months came back exactly. Whole-month replace re-imports February and April. Live: the 1,250-account import removed the sample's 193 rows in the same months (`sync_runs` `95a73c9d…`) |
| Variance verified against hand-computed figures; rounding sums exactly | **Met** | 20 hand-computed variance cells; 8 shared rounding cases, each summing to its annual figure. The same fixture is used by the browser preview (`budget.test.ts`) |
| Typecheck, lint and tests green locally and on GitHub Actions | **Met** | Locally: typecheck, lint, **257 tests** in 28 files, the build and the bundle check all pass. GitHub Actions on draft PR #1: section 9 |
| KPI definitions signed off by you; the KPI strip shows "—" with no data | **Met**, one part not shown live | Signed off 25 Nov 2026 for Phase 1 only (`docs/kpi-definitions.md`). "—" with no data is tested (`kpi.test.ts`, `kpi.test.tsx`). **Not shown on the preview:** both entities there have actuals, and I didn't create an empty one without your OK (section 7) |
| No Ledgrly table, policy, function or repo file modified (state how verified) | **Met** | Section 6 |
| Phone-width check done | **Met** | `P1-C.md` (Connect at 390 px) and `P1-E.md` (Plan and Compare at 390 px), checked by me on the demo build; your phone checks of Plan and Compare were fine |

## 3. Phase 1 requirements against their evidence

| Requirement (Phase 1 prompt) | Evidence |
|---|---|
| **Plan-line list** in a read-only `fpa.plan_line_defs`, seeded: the 11 lines, plus Unmapped (and, with your approval, Excluded) | Database tests: exactly 13 rows with their signs and kinds; nobody can update or insert; anon and service_role are refused |
| **Unmapped always shown, never dropped; it blocks "mapping complete"** | Database: `variance` returns an Unmapped line, and the budget is refused while any account is unmapped. Screens: `map.test.tsx` (one unmapped account among 1,234 blocks "complete"); Compare and the KPI strip show Unmapped and "incomplete" |
| **A sync replaces whole months**, in one transaction, logged in `fpa.sync_runs` | Database tests (whole-month replace, atomicity, `sync_runs` contents); live `sync_runs` rows (section 8) |
| **Compare shows "Actuals through [month], last synced [date]"** | **Added in the Gate 1 commit.** Compare showed only "Actuals through" until I found the gap in this review. Now tested in `compare.test.tsx` (the test fails without the fix) |
| **Rounding:** full precision, cents only for storage and display; the last month takes the leftover | `src/engine/rounding.ts` (37 tests); database tests (8 shared cases); the browser preview uses the same fixture |
| **KPI definitions** in `docs/kpi-definitions.md`, signed off before the strip is wired | Signed off 25 Nov 2026 for Phase 1 only, with the cash-burn points deferred; the strip was switched on only after that |
| **CSV import:** package-neutral with column matching; code, name (optional), month (YYYY-MM or a date), amount; trial-balance sign; display sign per line; template and sample; 20,000 rows and 5 MB; checked in the browser and again on the server | `actualsImport.test.ts` (28), `import.test.tsx` (18); database tests (31 refused inputs, exactly 20,000 accepted); the template download; `public/samples/` |
| **1A:** `import_actuals` (definer, fixed search_path, editor or owner, checks every row, whole months, `sync_runs`, one transaction, returns counts) | `P1-A.md` (permissions matrix, limits, atomicity); `GRANTS_EVIDENCE_0003.txt` |
| **1A:** line-map read and write functions, and unmapped accounts | `set_line_map`, `account_map`, `unmapped_accounts`: database tests; paging against the real API (P1-C: two pages, 0–999 and 1000–1266) |
| **1A:** `variance` (SQL aggregation, date-bound, invoker; percent null when the budget is 0) | 20 hand-computed cells; range limits; non-member PT404 |
| **1A:** budget from actuals (12-month window, uplift per line, rounding, refused if locked; owner-only unlock still holds) | Database tests (rounding cases, PT423, the owner-only unlock rule); timing 249 ms worst |
| **1A:** tests as every role, rolled back; grants evidence; plpgsql_check; read-only check that nothing persisted and history unchanged | `P1-A-timing.md`: test 0/276, rollback 0/9, dry run 0/15 (plpgsql_check 0 findings in 12 functions), each followed by a read-only check (history 102, nothing left) |
| **1A:** apply bundle and rollback; applied as in B3; anonymous-key requests refused | `P1-A-smoke.md` (section 4 below) |
| **1B:** upload, column matching, preview with row and validation counts, import, result summary, readable error list; fails closed | `import.test.tsx`; walk-through (P1-C) |
| **1C:** map each account, unmapped first, "mapping complete", suggestions never applied silently; walk-through and `P1-C.md` | `map.test.tsx` (15), `api.test.ts` (paging); walk-through recorded in P1-C |
| **1D:** choose the window, uplift per line, preview, create, edit lines by hand, lock (editors and owners), unlock (owners only) | `plan.test.tsx` (19), `plan/api.test.ts` (5), `budget.test.ts`; your walk-through (section 7) |
| **1E:** variance on Compare and the live KPI strip from the signed-off definitions; "actuals through"; "—" with no data; phone width | `compare.test.tsx` (14), `compare.test.ts`, `kpi.test.ts`, `kpi.test.tsx`; the live strip on the preview (section 7) |
| **UI rules** (`docs/ui-rules.md` §1–6, added at the 1A review) | Rule-to-test tables in `P1-C.md` and `P1-E.md`; ten rules broken on purpose to prove the tests can fail (five in 1C, five in 1E) |
| **Working rules:** phase-1 branch with a PR; CI green before merge; no merge until you approve each stop; preview only through GitHub-connected Vercel; made-up fixtures with neutral names | Draft PR #1; no merge; preview through the `preview` branch (option A, your choice); fixtures `public/samples/*` and the generator `scripts/make-actuals-csv.mjs` are made-up |

## 4. Database evidence for all seven new functions

All from the rolled-back test run of the **applied** text: `test_0003.sql`, sha-256
`85e92d0c5e6d5a24…`, byte-checked, **0 failures, 276 passes**.
- **Identities, each with real JWT claims:**
  - owner, editor and viewer of entity A;
  - an inactive member;
  - a non-member;
  - the owner of entity B;
  - anon and service_role;
  - a signed-in caller with no user id.

| Function | Runs as | Who may call | Cross-entity evidence |
|---|---|---|---|
| `import_actuals` | definer, fixed search_path | owner, editor | B's owner using A's connection through B's entity: **PT404**. A's owner using B's connection: **PT404**. Viewer, inactive member, non-member and B's owner on A: **PT403**. anon and service_role: **42501**. No user id: **PT401**. A's imports never touch B's rows |
| `set_line_map` | invoker | owner, editor | B mapping A's accounts: **PT403**; row security and the foreign key apply |
| `account_map` | invoker | any member | A's editor sees none of B's accounts; a non-member gets no rows |
| `unmapped_accounts` | invoker | any member | Returns exactly the caller's entity's one unmapped account; a non-member gets no rows |
| `variance` | invoker | any member | A non-member gets **PT404**; B's variance shows only B's actuals; B reading A's version through B's entity: **PT404** |
| `create_budget_from_actuals` | invoker | owner, editor | B writing into A's version through B's plan: **PT404**; non-editors refused; a locked version: **PT423** |
| `my_entity_ids` | definer, fixed search_path, STABLE | authenticated only | For all 9 identities, each gets only their own active entities at the role asked for. The read policies built on it return **identical rows to the Phase 0 rules for all 9 identities** on `actuals_monthly` and `line_map` |

**Grants** (`GRANTS_EVIDENCE_0003.txt`): of 27 fpa functions, none can be run by PUBLIC, anon or
service_role, and 10 internal helpers can be run by no API role. There are 42 policies, all TO
authenticated only.

## 5. Anonymous-key smoke test and timing

**Smoke test** (`P1-A-smoke.md`, 25 Nov, about 09:05 UTC):
- **14 of 14 refused:** the seven new functions, each called with the legacy anon key and with the
  publishable key.
- **Every response:** HTTP 401 with `{"code":"42501",…,"message":"permission denied for schema fpa"}`.
- **Control:** `public` still answers as before, with 200 and `[]`.

**Timing** (`P1-A-timing.md`): worst of 3 runs, as `authenticated`, with 50 other entities and 284,000
actual rows.

| Call | Worst |
|---|---|
| `import_actuals`, 20,000 rows, 5.0 MB | 1,341 ms |
| `account_map`, 1,500 accounts | 168 ms |
| `unmapped_accounts` | 163 ms |
| `create_budget_from_actuals` | 249 ms |
| `variance`, 36 months | 309 ms |

All are under your 3-second bar and the 8-second limit.

**Through the real gateway** (1C walk-through, gateway log): a 4.2 MB import request returned HTTP 200
after 3,866 ms at the server.

## 6. Ledgrly untouched: how it was verified

- **The Ledgrly repo** (`C:\Users\peter\Documents\finflow-deploy`):
  - HEAD is `51c5f24`, Peter's own commit of 18 Nov 2026;
  - `git status` is clean;
  - there are no commits since 23 Nov.

  Klaro work never wrote there.
- **Database changes** were only the two applied bundles. A scan of `apply_0001.sql` and
  `apply_0003.sql` finds no CREATE, ALTER, DROP, GRANT, REVOKE, INSERT, UPDATE, DELETE, TRUNCATE or
  COMMENT on any schema but `fpa`. The only schema statement is `CREATE SCHEMA IF NOT EXISTS fpa`. The
  apply checks also assert that no foreign key leaves `fpa`.
- **Migration history:** Supabase's history is still 102 rows. Neither the connector's migration
  feature nor `supabase db push` was used.
- **The app** talks only to `fpa`: the Supabase client is created with `db: { schema: 'fpa' }`, and no
  code switches schema.
- **The two clean-up scripts** touch only `fpa`: the B5 one, run with your OK, and the Phase 1 one,
  proposed below.

## 7. Browser walk-throughs and the live KPI strip

**1C** (25 Nov, about 10:02–10:05 UTC; recorded in `P1-C.md` from `sync_runs` and the gateway log):
- **One entity was used, "test 1".** The sample went in (193 rows, HTTP 200, 213 ms), then the
  1,250-account file (15,000 rows, a 4.2 MB request, HTTP 200, 3,866 ms), which replaced the sample's
  months.
- **Paging:** Map accounts read 1,267 rows in two requests (0–999 and 1000–1266), both HTTP 200.
- **Real export:** checked in the browser only, as asked; nothing was sent.
- **Not run:** the 16,000-row file was not imported. It wasn't required once the 15,000-row import
  had passed.

**1E** (25 Nov, about 10:38–10:46 UTC, in **Walkthrough Test 1**; read from the database):
- **Setup:** the sample was imported (193 rows, 17 accounts, all mapped).
- **"Budget Jan 2026 to Dec 2026":** 96 lines. It has no hand edits now, which is what the rebuild
  should leave, and it was locked and later unlocked (`unlocked_at` 10:46:08).
- **"Budget 2025 (test)":** 96 lines, for the optional variance step.
- **Your checks:** you reported the CSV download and the phone-width checks on Compare and Plan as
  fine.
- **Line count:** each budget has 96 lines (8 budget lines × 12 months). My walk-through text first said
  108; it is corrected in `P1-E.md`, and the screen always counted correctly.

**The live KPI strip on the preview** (25 Nov, after the switch; read-only):

| Entity | Revenue (month) | Net profit | Cash balance / Runway | Notes |
|---|---|---|---|---|
| Walkthrough Test 1 | **€65,024.39**, actuals through Dec 2025 | **€4,095.00**, actuals through Dec 2025 | "—" / "—" | Matches Compare's December actuals |
| test 1 | **€0.00**, a real zero: it has actuals, but its revenue accounts are unmapped | **-€805.14** | "—" / "—" | "Incomplete: 1,249 accounts unmapped", and under the strip "The profit figures are incomplete: 1,249 accounts are unmapped." |

**"—" on an entity with no data** is proved by the tests but **not shown on the preview**. Every entity
there has actuals, and creating an empty one would add data without your OK. Creating "Walkthrough
Test 2" with no import would show all four tiles as "—" with "No actuals yet". You can do that, or tell
me to.

## 8. Test data inventory (read 25 Nov 2026; nothing deleted)

| Entity | id | Made in | Contents |
|---|---|---|---|
| **test 1** | `78d06e2e-619a-4a0e-95cb-bdc55b8dc24d` | 1C walk-through, 10:02 UTC | 1 owner membership (`f63d9ff1…`); 1 CSV connection (`b56bc1d3…`); 15,000 actual rows (1,250 accounts, Jan–Dec 2025); 18 mappings (3 excluded), so 1,249 accounts are unmapped; 2 `sync_runs` (`d89fca3d…` sample, `95a73c9d…` large file); plan "Main plan" (`7a8eb52d…`), no budgets |
| **Walkthrough Test 1** | `5e42034c-9d0a-490e-aeac-4136280221d1` | 1E walk-through, 10:38 UTC | 1 owner membership (`2f511472…`); 1 CSV connection (`6d565cdb…`); 193 actual rows (17 accounts); 17 mappings (2 excluded); 1 `sync_runs` (`e2c6fe2f…`); plan "Main plan" (`f8ae0f63…`); 2 budgets: "Budget Jan 2026 to Dec 2026" (`2da05879…`, unlocked, 96 lines) and "Budget 2025 (test)" (`05bccf29…`, unlocked, 96 lines), each with a "Base" scenario |

**Totals:**
- 2 entities, 2 memberships, 2 connections, 2 plans;
- 2 budget versions, 2 scenarios, 192 budget lines;
- 35 mappings, 3 import records, 15,193 actual rows;
- no drivers, driver values or packs.

There are no other entities in `fpa`. The B5 test entities were deleted on 24 Nov with your OK.

**Proposed delete script:** `db/ops/PROPOSED_2026-11-25_delete_phase1_test_data.sql`. **It has not
been run.**
- **What it does:** every parent row is named by id (and name); every count is checked before and
  after; children are deleted first; any surprise rolls everything back.
- **Locked budgets:** it refuses to run while a test budget is locked. An owner unlocks it first.
- **Checks at the end:**
  - no user data is left in `fpa`;
  - the plan-line list still has 13 rows;
  - `fpa.schema_migrations` has 2 rows and Supabase's history 102.
- **Dry run (read-only):** I ran a copy that stops just before the first delete, in a read-only
  transaction. It compiled, every "before" check matched today's data, and it stopped at the
  deliberate "DRY STOP" error. Nothing was deleted.
- **When you say so:** I re-read the inventory, send the file exactly as plain SQL through the
  connector (it will ask for your confirmation), byte-check it, then read-only check.

## 9. Checks and CI

- **Locally, on the Gate 1 commit:**
  - typecheck and lint;
  - **257 tests** in 28 files: engine, data layer, screens, the migration planner and the secrets
    scanner;
  - `npm run build` and `npm run check:bundle` (no server secrets, no demo fakes).
- **GitHub Actions, on draft PR #1:**
  - green on `79b7801`: run 45595449744;
  - green on the commits since; the run for the latest commit is reported in the chat with its link.
  - The CI job runs `npm ci`, typecheck, lint, test, build and check:bundle.

## 10. Known limitations (honest list)

1. **The second-user browser check is still deferred** (known limitation 2, from B5).
   - Cross-user isolation rests on the database tests, which cover 9 identities with real JWT claims,
     and on row security with each user's own Clerk token.
   - Before any second real user gets access: sign in as them and confirm they see no entities and
     cannot open another entity by its address.
2. **The excluded total on Compare covers all imported months,** not just the year shown. The screen
   says so. A per-year figure needs a new database function.
3. **Hand edits to a budget save one line per request.** A save that fails partway says how many were
   saved and shows what is saved. It is not all-or-nothing.
4. **One CSV connection per entity** on the screens. The database allows more; the screens use the
   first.
5. **CSV files must be UTF-8.** An older Excel "CSV" with accents is refused, with how to fix it.
6. **The Ledgrly create-company wizard guard is still needed.** A Klaro-only user who opens Ledgrly
   would be offered the create-company wizard. Fixing that is a change to live Ledgrly, a separate piece
   of work for your approval, and **it must come before anyone outside Ledgrly is invited**
   (`FINAL.md`, Phase 0).
7. **Names in `fpa` are visible to anyone with the public key** (known limitation 1, accepted). No rows
   or values are exposed.
8. **Year-to-date files** need a row for every account in every month of the year. That follows "an
   error, not a guess" strictly, and some exports leave those rows out.
9. **The KPI strip's timeout wording** is a proposal still to confirm ("This took too long. Try again,
   and if it keeps happening, tell us.").
10. **Backlog for a later migration:**
    - an all-or-nothing save for hand edits (one function, one transaction);
    - the VAT draft (`0002_fpa_vat_rules_DRAFT.sql`, sha-256 `c52477a9…`), which waits for you to check
      every rate and due-date rule;
    - optionally, a per-year excluded total for Compare.

## 11. Deviations and corrections during Phase 1

- **Approved changes:**
  - the plan-line list gained a visible "Not in the P&L (excluded)" line (you approved it at the 1A
    review);
  - the display sign lives on `plan_line_defs`, not `line_map`;
  - draft migrations no longer block numbering.
- **One performance fix to 0003 before it was applied** (`my_entity_ids` and single-pass functions). You
  approved it, and equivalence was proved.
- **Your 1C instruction:** € / £ signs and brackets are accepted in amounts. I also refuse a sign in the
  other currency.
- **Corrections I made:**
  - the 96-line count in the 1E walk-through text;
  - Compare's missing "last synced", found in this review.
- **The walk-throughs differed from the written steps** (one entity in 1C). They are recorded as they
  happened, from the database.

## 12. Proposed Phase 2 (plan only; not started)

**Goal:** a live Cash balance and Runway, VAT timing on Cash, and Ledgrly as a second source, with the
same database process (numbered migrations, rolled-back tests, apply checks, smoke tests) and review
stops.

### 2A. Balance-sheet data and the cash balance

- **What the data needs to be:** Phase 1 stores monthly **movements** for P&L accounts. A cash balance
  needs **balances**.
- **Proposed:**
  - a new mappable line, "Cash and bank" (kind `balance`), outside the P&L;
  - the import learns that balance-sheet accounts carry the **month-end balance** (closing balance),
    not a movement;
  - stored in a new table `fpa.balances_monthly` (account, month, closing balance), so the P&L tables
    and every Phase 1 function stay unchanged;
  - **Cash balance** = the sum of the closing balances of accounts mapped to "Cash and bank", at the
    latest month of actuals, in display sign.
- **Accounts already mapped to "excluded":** bank and VAT accounts in the sample would be re-mapped. The
  screen would suggest "Cash and bank" for bank names. Nothing is changed for you automatically.

### 2B. Cash burn and runway (my recommended definition)

- **Cash burn** is the average monthly fall in the cash balance over the **last three complete
  months**, from month-end balances: (cash at the end of month *m−3* − cash at the end of month *m*)
  ÷ 3. Month *m* is the latest month of actuals, unless it is the current calendar month, in which case
  it is the month before. That matches the incomplete-month rule.
- **Not burning cash:** if the result is zero or negative (cash held or grew), Runway shows "n/a (not
  burning cash)".
- **Runway (months)** = cash balance ÷ cash burn, shown to one decimal, never rounded up. It shows "—"
  if fewer than four month-end balances exist.
- **Why this one:**
  - it needs only month-end cash, which 2A provides;
  - it matches the "average fall in the cash balance" wording you deferred;
  - an accountant can check it by hand.
- **What it includes:** financing (a loan drawn or repaid, an owner putting money in), so it is net
  cash burn, not operating burn. Excluding financing would need financing accounts mapped separately.
  I suggest that as a later option, not in Phase 2.

### 2C. VAT timing on Cash

- **Prerequisite:** the 0002 VAT draft, applied only after you check every rate and due-date rule
  against Revenue (IE) and GOV.UK (UK).
- **What Cash would show:** VAT payable or repayable per VAT period, from the VAT rate code on each
  mapped account (`line_map.vat_rate_code`, already in the schema), with the due date from the rules.
  The dates appear on Cash next to the cash balance.

### 2D. Ledgrly as a source (1F)

- **What it does:** a read-only connector, so a Klaro entity can take its monthly actuals from a
  Ledgrly company instead of a CSV.
- **How:**
  - a server-side function reads Ledgrly's figures for one linked company;
  - it writes them through the same whole-month replace as `import_actuals`;
  - it checks that the signed-in user may see that company in Ledgrly.
- **What changes in Ledgrly:** nothing, apart from granting Klaro's function read access, if that is
  needed at all. Any change on the Ledgrly side is a separate piece of work for your approval.
- **Ledgrly's test companies** (Kota, Fitzsimons Test, Test 1, test, test 2, H and Form11) are never
  offered as sources.

### Order and review stops

1. **2A, database:** test, then stop for your review.
2. **2A and 2B, screens and KPI strip:** stop for your review.
3. **2C:** only after you sign off the VAT rules; stop for your review.
4. **2D:** design first; stop for your decisions; then build; stop for your review.
5. **Gate 2.**

### Decisions I need from you before Phase 2 starts

1. **Balance-sheet data:** closing balances per month, as proposed, or opening balances plus movements?
2. **The cash-burn definition** in 2B, including or excluding financing, and the "n/a" rule.
3. **Runway display:** one decimal, never rounded up? Show "n/a" when not burning cash?
4. **VAT:** are you ready to check the 0002 draft's rates and due-date rules (IE and UK)? Cash or
   invoice basis by default?
5. **Ledgrly as a source:**
   - who may link a Klaro entity to a Ledgrly company (an owner of both?);
   - whether any read access on the Ledgrly side is acceptable;
   - confirming that Ledgrly's test companies are never offered as sources.
6. **The Ledgrly create-company wizard guard:** schedule it now, or before the first outside invite?
7. **Backlog:** add the all-or-nothing budget save and a per-year excluded total to 2A's migration, or
   leave them?
8. **Test data:** keep "test 1" and Walkthrough Test 1 into Phase 2 for testing, or run the proposed
   delete script after Gate 1?
9. **The KPI strip timeout wording** (section 10, item 9).
