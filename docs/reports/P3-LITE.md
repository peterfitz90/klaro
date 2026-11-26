# P3-LITE: Scenarios (thin Phase 3 slice)

Date: 26 Nov 2026. Branch: `phase-2`. Built after 2B was working. **`SCENARIOS_LIVE` is on,** because
its walk-through on the preview passed (below). **Not merged to main.**

## What it is

A **Scenarios** panel under the budget grid on Plan, for the selected budget and the year shown.

- **Scenarios:** Base is the budget as it is. Upside and Downside are offered by default, are
  renameable, and are saved when you press Save. You can have up to 5 scenarios, Base included.
- **Drivers per scenario,** entered as percentages from −100 to 1000 with two decimals, and applied
  to every month:
  - **Revenue change %** moves Revenue and Cost of sales;
  - **Payroll change %** moves Payroll;
  - **Other costs change %** moves Other operating costs;
  - Marketing, Rent and premises, Interest and Tax are unchanged.
- **The comparison table:** Revenue, Total costs and Net profit for the year, and **Closing cash at
  month 12 (indicative)**.
  - Closing cash = the latest cash balance (the same figure as the KPI tile) + the year's net profit.
  - It is labelled "indicative: profit used as a proxy for cash; ignores timing, VAT, tax, capex and
    financing".
  - It shows "—" without a cash balance, and says why.
- **The maths** is in `src/engine/scenarios.ts`, in exact cents. Each scaled line uses the budget
  rounding (`budgetFromActuals`): every month rounded on its own, and the last month takes the
  leftover cents. Display signs are as elsewhere.
- **Read-only for locked budgets and for viewers.** Opening the panel writes nothing.

## Storage: the existing tables, no migration, no grant widened

I checked first, in a rolled-back transaction as editor, viewer, outsider and anon. The existing
grants and row security already let an editor save:

| What | Result |
|---|---|
| Editor: insert scenarios, drivers and driver values; update a value; rename and delete a scenario | All allowed |
| Editor: a second Base scenario | Refused (`scenarios_one_base`) |
| Viewer | Reads only; writes affect 0 rows or are refused |
| Outsider | Sees nothing |
| Anon | Refused (42501) |
| Locked budget: every write | Refused (PT423); reading still works |
| An upsert into `driver_values` | **Refused** (42501): UPDATE is granted on `value` only |

**So the panel saves:**
- **Scenarios** are rows in `fpa.scenarios` for the budget version.
- **Drivers:** three rows in `fpa.drivers` per plan (`scn_revenue_change`, `scn_payroll_change`,
  `scn_other_costs_change`; unit `percent`, kind `input`), created on the first save.
- **Values:** one row per driver per scenario in `fpa.driver_values`, stored at the budget year's
  first month. New values are inserted in one request; existing ones are changed by updating `value`
  only. No upsert, because the grants would refuse it.

**Not atomic across requests.** A save is several requests: drivers, new scenarios, renames, new
values and changed values. If one fails partway, the panel says "Not everything was saved: … The
table now shows what is saved", and reloads what is saved. Each request on its own is
all-or-nothing.

## Tests

- **Engine** (`src/engine/scenarios.test.ts`, 7 tests): a hand-computed fixture.
  - **Base:** profit 479.64.
  - **Upside** (+10% / +5% / −3.33%): profit 1,059.61, and the last month takes the leftover cent
    (96.69).
  - **Downside:** a loss of 300.38, with closing cash 95,099.62.
  - Also: the totals of the rounding, −100%, the indicative cash and its "—", and percent parsing.
- **Screen** (`src/features/plan/scenarios.test.tsx`, 17 tests):
  - the defaults, and that nothing is written on open;
  - the figures as you type;
  - the indicative label, and "—" with no cash or a failed cash load;
  - the first save (drivers, two scenarios, six values);
  - a later save (an update of `value` only, and a rename);
  - a bad percentage; duplicate names; the most is 5;
  - a partial failure; a budget locked meanwhile (PT423); the locked view; the viewer;
  - delete with confirm; stored values with trailing zeros.
- **Phase 1 and 2 tests:** no assertion changed. `plan.test.tsx` gained stubs for the panel's data
  calls (no scenarios, no balances), because the panel now renders under the budget there.
- **Totals:** 345 tests, lint, typecheck and build all pass.

## Walk-through on the preview (real database, 26 Nov 2026)

The walk-through used Walkthrough Test 1 → "Budget 2025 (test)", the budget named as a test, and not
the demo's 2026 budget.

- **Opening the panel wrote nothing.**
  - Base read Revenue €724,564.25, Total costs €631,134.69, Net profit €93,429.56. This matches a
    direct database sum to the cent (96 lines).
  - Closing cash showed "—", because no balances are loaded.
- **Typing drivers:** Upside +10% revenue and +5% payroll gave €797,020.68 / €671,548.28 /
  €125,472.40. I checked the costs in the database: 291,004.76 + 293,130.87 + 87,412.65 =
  671,548.28.
- **Save scenarios:** "Scenarios saved". It created Upside and Downside, the 3 drivers and 6 values,
  and read them back.
- **Downside −10% revenue, then Save:** the database shows that value **updated in place**, and the
  others untouched. Downside revenue reads €652,107.83.
- **What these writes left:** two scenarios, three drivers and six values on that test budget. I
  deleted nothing. They are the starting point for the demo's final 2 minutes.
- **Not walked through in the browser:**
  - the locked view, because I did not lock a demo budget for this. It is covered by the database
    probe (PT423) and a screen test;
  - the 390px phone check, because the preview refuses to load inside a frame (a security header).
    The table sits in its own scrolling container.

## Rough edges

- **A save is several requests,** as described above: it fails honestly, but not atomically.
- **One value per driver per scenario,** at the year's first month. Monthly drivers would need more
  work.
- **"Unsaved changes" shows** when the defaults appear and nothing is saved yet.
- **Closing cash is profit-based,** as its label says. It is not a cash forecast.
- **On a phone the table scrolls sideways** inside its box.

## For you to check

1. The panel on the preview: steps 9–10 of `docs/demo-script.md`.
2. Whether the default Upside and Downside should be saved automatically on first open. I chose not
   to write anything just by opening the panel.
3. The draft PR and the merge, when you approve.
