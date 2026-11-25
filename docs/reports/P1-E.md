# P1-E: budget from actuals, Compare and the KPI strip (1D and 1E review stop)

25 Nov 2026, branch `phase-1` (draft PR #1). **Nothing is merged to main and no database change was
made**: 1D and 1E use the functions applied in 0003. Gate 1 and 1F are not started. The KPI strip is
wired but **not switched on**, pending your sign-off of `docs/kpi-definitions.md`.

> **Correction (25 Nov 2026, after the walk-through):** this report first said a rebuild replaces
> **108** lines. The right number is **96**: 8 lines take a budget (Revenue, Cost of sales, Payroll,
> Marketing, Rent and premises, Other operating costs, Interest, Tax), and 8 × 12 months is 96. The
> screen was always right, because it counts the lines in the database. The mistake was only in this
> report's text and in a made-up count in one test, and both are now corrected. Each budget in
> Walkthrough Test 1 has 96 lines.

## What changed

| Item | Result |
|---|---|
| 1D: Plan › Budgets | New budget from 12 months of actuals with an uplift per line and a line-by-line preview; rebuild with a count of lines to be replaced (and how many were edited by hand) and an explicit yes; lock (editors and owners) and unlock (owners only); edit lines by hand |
| 1E: Compare | Budget against actuals from `fpa.variance`: month and year to date, or every month; favourable or not as ▲ Fav / ▼ Unfav as well as colour; CSV export; the excluded count and net total always shown; the incomplete-month note; the Compare timeout wording |
| 1E: KPI strip | Wiring built and tested (`src/engine/kpi.ts`, `src/features/kpi/LiveKpiStrip.tsx`); **off** (`KPI_STRIP_LIVE = false` in `src/app/shell/kpiSwitch.ts`). Cash balance and Runway stay "—" |
| 1C close-out | The checklist results are recorded in `P1-C.md` from `sync_runs` and the gateway log; 1C is marked closed. The walk-through used one entity, "test 1" (see P1-C) |
| Checks | Typecheck, lint, **255 tests**, the build and the bundle check pass locally. GitHub Actions runs on the draft PR (see the chat for the run) |

## The screens, in plain language

### Plan › Budgets

1. **Budgets card.**
   - "Actuals through Dec 2025", a **Budget** drop-down (locked budgets say so), and **New budget from
     actuals** for editors and owners.
   - A viewer is told that building or changing a budget needs editor or owner access.
   - With no actuals it says to import them on Connect first.
2. **New budget from actuals.**
   - **Name** (suggested: "Budget Jan 2026 to Dec 2026").
   - **Actuals: 12 months from**, defaulting to the latest 12 months.
   - **Budget: 12 months from**, defaulting to the month after the latest actuals. The same months as
     the actuals window are allowed too, for a test budget to compare.
   - A table with one row per budget line: Actuals for 12 months, **Uplift %**, and Budget for 12 months.
     The budget is worked out as you type, with the same rounding as the database: each month to
     cents, and the last month takes the rest. A Net profit row is underneath.
   - **What blocks Create:**
     - a month in the window with no actuals ("No actuals for Mar 2025");
     - unmapped actuals in the window ("Map every account first", with the amount);
     - an uplift outside -100% to 1000%;
     - an empty name.
   - **Create the budget.** On a phone the table becomes one block per line.
3. **The budget itself.**
   - The 12 months of a financial year, with line names in the first column, which stays in view while
     the months scroll sideways.
   - Revenue and profit are shown and typed as positive numbers; the screen stores revenue in the
     stored sign.
   - An edited cell is outlined until saved. A line edited by hand carries a ✎ mark.
   - Gross, Operating and Net profit rows add up as you type.
   - **Save N changes** and **Discard changes**.
   - An amount that isn't an amount saves nothing and names the cell ("Revenue, Jan 2026: …").
4. **Lock this budget** (editors and owners) and **Unlock** (owners only).
   - **Once locked:** a "Locked" badge, no editing, and the note "Only an owner can unlock it", or
     "You can unlock it" for an owner.
5. **Rebuild from actuals….**
   - Opens the same form for this budget.
   - **Rebuild…** first counts the lines in the 12 budget months and asks: "**Rebuilding replaces 96
     lines in Jan 2026 to Dec 2026, including 1 line edited by hand.** This cannot be undone."
   - **Replace 96 lines** or **Cancel**. Cancel changes nothing.
   - For a locked budget the form says "**This version is locked. Unlock it first.**" and **Rebuild…**
     is greyed out. If the database refuses anyway (PT423), the screen says the same.

### Compare

1. **Choices:**
   - **Budget**, or "No budget (actuals only)";
   - **Financial year**, defaulting to the year of the latest actuals;
   - **Month**, defaulting to the latest month of actuals;
   - **Show**: *Month and YTD* or *Every month*.
2. **The always-there line:**
   - "Actuals through Dec 2025. Revenue, costs and profit are shown as positive numbers; a cost over
     budget is unfavourable."
   - **"Not in the P&L (excluded): 2 accounts, net total €6,936.49 Dr across all imported months."**
     It is shown even at 0, and it also says when accounts are still unmapped.
3. **Month and YTD.**
   - For each line: Budget, Actual, Variance, Var % and ▲ Fav or ▼ Unfav, for the month and for the
     year to date.
   - **Year to date** runs from the start of the financial year to the chosen month. If any month in
     it has no actuals (or no budget), that figure is "—", not a partial sum.
   - Calculated lines are in bold. The Unmapped line has no favourable mark.
   - On a phone each line becomes a block: "Budget, Dec 2025: …".
4. **Every month.** One figure per month (Variance by default, or Actual, Budget or Variance %), with
   the year to date. The line names stay in view as it scrolls sideways.
5. **Notes:**
   - "No budget chosen" or "This budget has no lines in this year": the Budget figures show "—".
   - "No actuals in this year yet": the Actual figures show "—".
   - "**Dec 2026 is this month: its actuals may be incomplete.**" This appears when the latest month
     of actuals is the current calendar month. In Every month it is a * on that month.
6. **Export ▾ › Download CSV.**
   - Every line and month (budget, actual, variance, variance %, favourable, and the incomplete-month
     note), plus a year-to-date row per line.
7. **Timeout:** "This took too long. Try a shorter date range." No figures are shown.

### KPI strip (built, not on)

- **Shown today:** the same placeholders as before ("—").
- **When switched on:**
  - Revenue (month) and Net profit for the latest month, each with "Actuals through Oct 2026";
  - "Month may be incomplete" beside both when that month is this month;
  - "Incomplete: N accounts unmapped" under Net profit, and a line under the strip;
  - Cash balance and Runway stay "—".
- **If loading fails:** every tile shows "—" and why, never a zero.

## Every rule and its test

| Rule | Test |
|---|---|
| §1 Lists read in pages of 1,000 | Compare's excluded totals use `account_map` through `pageAll` (tested in 1C). `plan/api.test.ts`: variance read in pages (0–999, 1000–1999) |
| **§2 Excluded count and net total on Compare, also at 0** | `compare.test.tsx`: "2 accounts, net total €300.00 Dr"; "0 accounts, net total €0.00" |
| **§4 Rebuild: how many lines, how many by hand, explicit yes** | `plan.test.tsx`: the dialog text; the counts are asked for the version's 12 budget months; nothing is sent before the yes |
| §4 Cancel changes nothing | `plan.test.tsx` |
| §4 Locked: no rebuild, "Unlock it first" (screen and PT423) | `plan.test.tsx`: both cases |
| §4 The counts are exact (not the row cap) | `plan/api.test.ts`: `count: 'exact', head: true` on the base scenario's 12 months, all and `origin = manual`; a missing count is an error |
| **§5 "Month may be incomplete" on Compare and the KPI strip** | `compare.test.tsx` (note and grid mark when the latest month is this month; none otherwise); `kpi.test.ts`, `kpi.test.tsx` (beside Revenue and Net profit only) |
| **§6 Timeout wording: budget (create and save), Compare** | `plan.test.tsx` (two); `compare.test.tsx` (no table shown) |
| 1D: revenue typed positive, stored in the stored sign | `budget.test.ts`; `plan.test.tsx` (1,500 typed → `-1500.00` sent; costs `450.00`) |
| 1D: an edit sets origin "manual" | `plan/api.test.ts` (the update sends `origin: 'manual'`); `plan.test.tsx` (✎ shown for manual lines) |
| 1D: editors lock, owners unlock | `plan.test.tsx` (editor locks, has no Unlock; owner unlocks); `plan/api.test.ts` (what is sent; a reply that disagrees is an error) |
| 1D: uplift per line; preview = database rounding | `budget.test.ts`: every case in the shared fixture `db/tests/fixtures/rounding_cases.json`, which the database tests also use; display sign and stored sign agree; `plan.test.tsx`: preview and the exact arguments sent |
| 1D: window needs 12 months of actuals; unmapped blocks | `plan.test.tsx` |
| 1E: budget, actual, variance, variance %, month and YTD | `compare.test.ts` (engine); `compare.test.tsx` (exact cells for Revenue, Payroll and Net profit) |
| 1E: variance % null for a zero or missing budget | `compare.test.ts` |
| 1E: YTD needs every month | `compare.test.ts`; `compare.test.tsx` ("—" for a month with no actuals and for the YTD that includes it) |
| 1E: favourable with a word or symbol as well as colour | `compare.test.tsx` ("▲ Favourable" and "▼ Unfavourable" in the text); `compare.test.ts` (the rule per kind of line) |
| 1E: CSV export through ExportDropdown | `compare.test.tsx` (header, a month row and a YTD row; 157 rows) |
| KPI: four KPIs; Revenue (month) and Net profit from the latest month | `kpi.test.ts`; `kpi.test.tsx` (variance asked for that one month) |
| KPI: "actuals through" on every KPI | `kpi.test.ts`, `kpi.test.tsx` |
| KPI: "—", never zero, with no data; a real zero shows as zero | `kpi.test.ts`, `kpi.test.tsx` |
| KPI: Cash balance and Runway "—" in Phase 1 | `kpi.test.ts`, `kpi.test.tsx` |
| KPI: unmapped makes the profit figures incomplete, with how many | `kpi.test.ts`, `kpi.test.tsx` |
| KPI: a failed load shows "—" and why | `kpi.test.tsx` |
| KPI: not switched on before sign-off | `kpi.test.tsx` (`KPI_STRIP_LIVE` is `false`) |
| Errors are not "empty" | `plan.test.tsx` (viewer), `compare.test.tsx` (a failed load is an error, not "Nothing to compare yet") |

**The tests can fail.** I broke five rules one at a time; each break made tests fail, and the code was
put back afterwards (255 pass after):

| Rule broken | Tests that failed |
|---|---|
| Rebuild without the confirmation (§4) | 4 |
| Excluded line hidden on Compare when 0 (§2) | 1 |
| KPI shows zero with no data | 2 |
| Typed revenue stored without the sign | 3 |
| Incomplete month not marked on Compare (§5) | 1 |

My first try at the §2 break left the file invalid, which proves nothing, so I redid it as a valid
change.

## Phone width (390 px)

I checked this on the demo build (made-up data; it never builds for deploy), in a 390 px frame. The
page never scrolls sideways (page width 384 px plus the scrollbar).

| Screen | At 390 px |
|---|---|
| Plan › New budget | The line table stacks into one block per line: label, Actuals, Uplift % (full-width input) and Budget |
| Plan › budget grid | The 12-month grid scrolls sideways inside its box, with the line names pinned. Twelve months side by side cannot fit a phone |
| Compare › Month and YTD | One block per line with labelled figures, for example "Budget, Dec 2025: €…" |
| Compare › Every month | Scrolls sideways inside its box, with the line names pinned |

**Fixed along the way:**
- **Hidden labels widened the page.** The labels screen readers use, inside the scrolling grid,
  stretched the page to 1,606 px. The scrolling box now contains them.
- **Row names looked like column headings.** They were styled as headings (small capitals on grey);
  they are now normal text.

## Choices I made that you may want to change

1. **Excluded net total on Compare is across all imported months**, not just the year shown, and it says
   so. A per-year figure would need a new database function. Say if you want one.
2. **Year to date is "—" if any month in it lacks actuals** (or budget), rather than a partial sum.
3. **Compare's defaults:**
   - the latest budget;
   - the financial year of the latest actuals;
   - the latest month of actuals.

   For your 2026 budget against 2025 actuals, choose the 2026 year to see the budget; its actuals show
   "—" until 2026 actuals arrive.
4. **A budget may start in the same months as its actuals window,** to make a test budget to compare.
5. **Saving hand edits is one request per line.** If a save fails partway, the screen says how many
   were saved and shows what is saved. A single all-or-nothing save would need a new database function.
6. **Proposed KPI strip timeout wording:** "This took too long. Try again, and if it keeps happening,
   tell us." It is recorded in `docs/ui-rules.md` §6 as a proposal.

## Preview

- **Merge:** I merged phase-1 (`79b7801`) into `preview` as `f194565` and pushed it, as for 1C
  (option A). The merged files are identical to phase-1.
- **Build:** Vercel reported "Deployment has completed".
- **What `klaro-preview.ledgrly.ie` serves:** bundle `index-ByUCANF3.js`, with the live Clerk key, no
  development key, and the Budgets, Compare and rebuild-warning text.
- **CI:** GitHub Actions passed on draft PR #1 for `79b7801`
  (https://github.com/peterfitz90/klaro/actions/runs/45595449744).
- **A read-only look at "test 1" on the preview** (no clicks that save):
  - **Plan:** "Actuals through Dec 2025", "No budgets yet".
  - **Compare:** loads the real figures for Dec 2025, with no alerts:
    - Marketing €805.14, the one account mapped there;
    - Operating and Net profit -€805.14;
    - Unmapped -€133,396.26, from the 1,249 unmapped accounts;
    - "Not in the P&L (excluded): 3 accounts, net total €0.00". Those accounts have no actuals left
      in that entity.
  - **The KPI strip** still shows "—" in all four tiles.

## Walk-through for you (on the preview)

"Walkthrough Test 1" does not exist yet: 1C was done in "test 1", whose 2025 actuals are now the
1,250-account file with 1,249 accounts unmapped. So step 2 creates it, with the sample. Nothing is
deleted.

1. Open https://klaro-preview.ledgrly.ie and sign in. Make sure the new build is there:
   - **Plan** shows a **Budgets** card;
   - **Compare** shows Budget, Financial year and Month choices.
2. **Set up Walkthrough Test 1:**
   1. Create an entity `Walkthrough Test 1` (Ireland, EUR, year starting January).
   2. On **Connect**, add a CSV connection. Import the sample (**Download the sample file**, then choose
      it, **Check the file**, **Import 193 rows**).
   3. On **Map accounts**, click **Use all 16 suggestions** and **Save 16 changes**.
   4. Set **Clearing 7** to **Other operating costs** and **Save 1 change**. Expect "✓ Mapping
      complete".
3. **A 2026 budget with uplifts.**
   1. On **Plan**, click **New budget from actuals**. Expect actuals Jan 2025 to Dec 2025, budget Jan 2026
      to Dec 2026, and the name "Budget Jan 2026 to Dec 2026".
   2. Type uplifts: Revenue **5**, Payroll **3**, Marketing **10**. Check:
      - **Revenue** goes from €724,564.25 to **€760,792.46**;
      - the **Net profit** row changes as you type.
   3. Click **Create the budget**. The 2026 grid appears with the line names on the left.
4. **A hand edit.** In **Revenue, Mar 2026** type `50,000` and click **Save 1 change**. Expect
   "Saved 1 change." and a ✎ on that cell. Net profit for March changes.
5. **Rebuild warning (§4).**
   1. Click **Rebuild from actuals…**, then **Rebuild…**. Expect: "**Rebuilding replaces 96 lines in Jan
      2026 to Dec 2026, including 1 line edited by hand.** This cannot be undone."
   2. Click **Cancel**. Nothing changes: the ✎ is still there.
   3. Click **Rebuild…** again, then **Replace 96 lines**. The budget is rebuilt and the ✎ is gone.
6. **Lock, then try to rebuild.**
   1. Click **Lock this budget**. Expect the "Locked" badge, no editable cells, and (as the owner) an
      **Unlock** button.
   2. Click **Rebuild from actuals…**. Expect "**This version is locked. Unlock it first.**" with
      **Rebuild…** greyed out. Click **Cancel**.
7. **Compare.**
   1. Open **Compare**. Expect:
      - the budget chosen;
      - financial year Jan 2025 to Dec 2025, month Dec 2025;
      - the note "This budget has no lines in this year" (2025 has actuals only);
      - **Not in the P&L (excluded): 2 accounts, net total €6,936.49 Dr**.
   2. Change **Financial year** to Jan 2026 to Dec 2026. Expect the budget figures, "No actuals in this
      year yet", and Actual and Variance as "—".
   3. Click **Every month**, and try the **Figure** choice.
   4. Open **Export ▾ › Download CSV** and check that the file opens.
8. **Optional, to see real variances.**
   1. On **Plan**, click **New budget from actuals** again.
   2. Set **Budget: 12 months from** to **Jan 2025 to Dec 2025**, name it `Budget 2025 (test)`, and set
      uplifts Revenue **5** and Payroll **-3**. Create it.
   3. On **Compare**, choose it, year 2025, month Dec 2025. Expect:
      - **Revenue** ▼ Unfav (actual below a budget 5% higher);
      - **Payroll** ▼ Unfav (actual above a budget 3% lower);
      - lines with no uplift on budget, ▲ Fav;
      - a year-to-date column for Jan to Dec 2025.
9. **Phone width.** On your phone, look at Plan (the new-budget form and the grid) and Compare (Month
   and YTD, and Every month). Check that the page itself never scrolls sideways.
10. **The KPI strip** should still show "—" in all four tiles. It is not switched on until you sign off
    `docs/kpi-definitions.md`.
11. **Optional:** **Unlock** the 2026 budget again as the owner.

Then tell me what you saw. I will:
- read the versions and line counts read-only and record them here;
- wait for your approval of the 1E review stop, and your sign-off of the KPI definitions, before the
  strip is switched on or anything merges.
