# P4-CASH: the Cash page

Date: 26 Nov 2026. Branch: `phase-4`, from `main`. Merged into `preview`; **not merged to main.**

CI is green on GitHub Actions: [run 45845674245](https://github.com/peterfitz90/klaro/actions/runs/45845674245)
on `b02dd27`. The final docs commit's run is in my reply.

**`CASH_PAGE_LIVE`:**
- **On in the `preview` branch only,** in a single preview-only commit, because the walk-through
  passed.
- **Off in `phase-4`,** so main keeps the placeholder until you approve. To switch it on: one line,
  plus its test.

**No migration.** See `docs/reports/P4-0.md`: the page reads under the user's own row security, with
no new function and no grant change.

## What it is

A one-page Cash view, on screen and printable. It uses the Report's print and colour stylesheet. It
only reads, and opening it writes nothing.

- **Header:**
  - the entity, "Cash: [first history month] to [last projected month]", and who generated it and
    when;
  - "Balances through …. Actuals through …." Whichever is missing says so.
- **Not set up:**
  - No account on Cash and bank: only "Map your bank accounts to Cash and bank" and a link to Map
    accounts.
  - No balances at all: only "No month-end balances imported yet", with a link to Connect.
  - Never a 0.00.
- **1. Cash now:** Cash balance, net cash burn (labelled "includes loans and owner funding") and
  Runway, from `cashKpis`, the KPI strip's own engine. A test renders both from the same inputs and
  compares them.
- **2. History and projection:**
  - up to 12 month-ends of history, then a 12-month **Current trend**: cash now − k × burn, in exact
    cents;
  - "Cash runs out: [month]" is marked on the chart, or "Cash does not run out within 12 months";
  - the projected part is dashed and labelled "Projection (not a forecast)";
  - a table of every month and value sits under the chart, as its text alternative;
  - every line has its own dash pattern and marker, and is named in the legend.
- **3. Scenarios as cash:**
  - the budget defaults to the latest one with saved scenarios;
  - each scenario's profit comes from the existing scenario engine (`applyScenario` / `summarise`);
  - its line is the Current trend plus round(k × difference ÷ 12);
  - the table shows the difference, cash at month 6, cash at month 12 and when cash runs out, with
    the indicative caveat;
  - "—" and the reason when there is no budget, no saved scenario, or no projection.
- **4. What-if (not saved):** the burn input is prefilled with the current figure. It redraws a
  dotted line in the browser only, with Reset. Nothing is saved.
- **5. Data quality and notes:**
  - unmapped balance accounts;
  - balances older than actuals;
  - fewer than four consecutive month-ends (no burn, runway or projection, and why);
  - a latest month that is this month;
  - "None" when clean, and the fixed line.
- **Print / save as PDF**, and **Download CSV** (month, cash, kind, line).
- **Failures:** each section loads on its own, so one that fails shows its own error, with the
  `ui-rules` §6 wording.
- **The shell's KPI strip is not repeated** on Cash while the page is on, because "Cash now" shows the
  same figures.

## Tests

**414 tests pass.** Lint, typecheck, the build and `check:bundle` are clean. No existing test
changed.

- **Engine** (`src/engine/cashProjection.test.ts`, 14 tests, all hand-computed from Test 2's
  figures):
  - the projection months;
  - runs out in Aug 2026;
  - Upside (+27,930.61) runs out in Oct;
  - Downside (−59,565.24) in Jun;
  - Hiring plan (+16,009.98) in Sep;
  - rounding to the cent (€1.00 a year comes to exactly €1.00 by month 12);
  - the what-if;
  - not burning cash;
  - cash at or below zero;
  - fewer than four month-ends;
  - burn parsing;
  - the history sum;
  - the notes;
  - the CSV.
- **Screen** (`src/features/cash/cash.test.tsx`, 18 tests):
  - the switch and placeholder; the header;
  - Cash now, and its equality with the KPI strip;
  - not set up; no balances;
  - the projection and its table; fewer than four month-ends;
  - a failed history call; a failed budgets call;
  - the scenario defaults, order and figures; no scenarios; no budget;
  - the what-if and Reset;
  - data quality; the CSV;
  - a viewer; nothing written on open.

## Walk-through on the preview (real data, read-only)

**Walkthrough Test 2:**
- **Cash now:** €95,400.00, €12,150.00 a month and 7.8, the same as the strip.
- **History:** Jan–Dec 2025 (€106,670.15 … €95,400.00); 24 table rows.
- **Current trend:** runs out in Aug 2026 (month 8).
- **Scenarios:** Base, Upside, Downside and Hiring plan, exactly as in the engine tests (the table in
  `docs/demo-script.md`).
- **What-if:** at 8,000 it runs out in Dec 2026; Reset works.
- **Data quality:** "None".
- **No errors,** and the strip is not repeated.

**Print layout,** measured with the page's print rules at A4's 186mm content width:
- the sidebar, top bar, buttons and what-if input are hidden;
- the two tables are 684px and the chart 685px, inside the page;
- about two pages;
- colours as on the Report: history green, trend blue, scenarios amber, red and purple, the runs-out
  marker red.

**Walkthrough Test 1:** "No month-end balances imported yet", with a link to Connect, and no 0.00.
Test 1 has no balances, so this is the state it shows.

**Walkthrough Test 3:** doesn't exist.

**A viewer:** in a rolled-back check as Sean (viewer on Test 2), every read the page makes returned
the same figures (cash €95,400.00, 2 cash accounts, 24 cash rows, 4 scenarios, 9 driver values). His
write attempt changed 0 rows.

## Not checked

- **A real PDF.** The print dialog would block my browser tools; I measured the print layout instead.
  Please print it once.
- **Phone width.** The preview can't be framed and the window won't shrink. Sections stack and tables
  scroll in their own boxes by design, but I haven't seen it.
- **Signing in as a viewer.** I checked it in the database as Sean, plus a screen test; not by
  signing in as him.
- **The "Map your bank accounts" state on real data:** no entity is in that state. A screen test
  covers it.

## Rough edges

- **The projection starts after the latest balances (Dec 2025), not today** (P4-0, point 1).
- **The scenarios' profit comes from a 2025 budget** and is applied to the 2026 projection. It is
  labelled (P4-0, point 2).
- **The chart's axis shows only the top value, €0 and the lowest value;** the table has every
  figure.
- **The history uses the balances import log for its months.** A month imported with no cash row
  shows €0.00, as on the strip.
