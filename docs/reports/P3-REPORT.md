# P3-REPORT: the monthly report

Date: 26 Nov 2026. Branch: `phase-3`, from `main`. Merged into `preview`; **not merged to main.**

CI is green on GitHub Actions: [run 45803726028](https://github.com/peterfitz90/klaro/actions/runs/45803726028)
on `b458d67`.

**`REPORT_LIVE`:**
- **Off in `phase-3`.** Merging it to main changes nothing on production: Report stays the
  placeholder.
- **On in the `preview` branch only,** in a single preview-only commit. That is where it was walked
  through, and where the demo runs.

**Why it stays off in `phase-3`:** I could not print it to a real PDF or look at a PDF (see "Not
checked"). Everything else passed. Once you have printed it from the preview and are happy, switching
it on in `phase-3` is a one-line change, plus its test.

## What it is

A one-page monthly board pack on **Report**. It only reads, through the same calls as the other
screens, under the user's own row security. Opening it writes nothing, and viewers can see it.

- **Header:**
  - the entity, "Monthly report: [Month Year]", and who generated it and when;
  - the sources line: "Actuals through …, last synced …. Balances through …." Whichever source is
    missing says so.
- **Selectors (not printed):**
  - **Month:** the last 24 months; the default is the latest month of actuals.
  - **Budget:** the default is the latest budget covering that month; "No budget" is allowed.
- **1. Headlines:** the KPI strip's own loader and rules (`loadKpis`), with the same wording.
- **2. Budget against actual:**
  - Compare's exact path: `variance` → `toLines` → `sumCells`, with `formatPct`.
  - It shows the month and the year to date, with "Favourable" or "Unfavourable" as words.
  - Budget figures show "—" with the reason when there is no budget for the year.
  - **Download CSV** uses Compare's own export. I extracted it as `compareCsvRows`; Compare behaves
    exactly as before, and its tests are unchanged and pass.
- **3. Trend:** plain inline SVG, with no new dependency.
  - **Revenue and net profit** for the financial year to the month. Actuals are solid, the budget is
    dashed, and the markers differ (circle or square). It has a word legend, an `aria-label` with
    every value, and a table for screen readers.
  - **Month-end cash** for the last 5 month-ends. Bars have their value written on them, with
    runway and net cash burn beside. When cash isn't set up, it shows "—" and the same text as the
    tile.
- **4. Scenarios:** the saved scenarios for the chosen budget, read-only, with the same maths and
  caveat as the panel. With none saved: "No scenarios saved for this budget."
- **5. Data quality and notes:**
  - unmapped P&L accounts (how many, and their net amount);
  - unmapped balance accounts;
  - balances older than actuals (how many months);
  - a month that may be incomplete;
  - "None" when there is nothing to report;
  - then the excluded total and the fixed line "Figures come from the imported files; this report is
    not audited. Closing cash is indicative."
- **Failures:** each section loads on its own, so a failed or timed-out section shows its own error
  (with the `ui-rules` §6 wording) and the rest still render.
- **Print / save as PDF** (`window.print`), with a print stylesheet:
  - A4, black on white;
  - no sidebar, top bar, pickers or buttons;
  - table rows, KPI cards and charts are not split across pages;
  - one chart per row;
  - table cells at 7.5pt, so the 11-column table fits A4. That was measured, below.
- **The shell's KPI strip is not repeated** on Report while it is on, because Headlines shows the
  same tiles.

## Tests

**378 pass in total.** Lint, typecheck, the build and `check:bundle` are clean. No existing test was
changed.

- **Engine** (`src/engine/report.test.ts`, 9 tests):
  - the chart scale: the domain always includes 0, a loss sits below the baseline, nulls are
    ignored;
  - the data-quality notes: each case, and "None" when clean;
  - month helpers.
- **Screen** (`src/features/report/report.test.tsx`, 21 tests):
  - the switch and the placeholder;
  - the header and the sources line, including missing balances;
  - the defaults, where the latest budget covering the month wins over a later one that doesn't;
  - opening writes nothing, and a viewer sees every section;
  - **Section 2 is cell-for-cell equal to Compare** rendered from the same inputs;
  - the CSV equals Compare's export; no budget;
  - the headlines; month-end cash with runway and burn; cash not set up;
  - scenarios: none saved, saved (the hand-computed figures), read-only;
  - data quality: clean, and with issues;
  - each of a failed figures call, a failed cash call and a failed scenarios call, with the other
    sections still rendering;
  - Print calls `window.print`.

## Walk-through on the preview (real data, read-only)

**Walkthrough Test 1, Dec 2025.** The budget defaulted to "Budget 2025 (test)".
- **Headlines:** €65,024.39 and €4,095.00; Cash and Runway "—", "No balances yet".
- **Section 2:** budget equals actual on every line. Revenue €65,024.39 for the month and
  €724,564.25 for the year to date; Net profit €4,095.00 and €93,429.56. These are Compare's figures
  for the same year.
- **Scenarios:** Base, Upside and Downside exactly as the panel shows them; closing cash "—".
- **Data quality:** "None"; excluded 2 accounts, €6,936.49 Dr.

**Walkthrough Test 2, Dec 2025.** The budget defaulted to "No budget", because "Review budget 2026"
doesn't cover Dec 2025.
- **Headlines:** Cash €95,400.00, Runway 7.8, €12,150.00/month.
- **Month-end cash, Aug–Dec 2025:** €133,562.08, €131,850.00, €121,095.37, €108,180.12 and
  €95,400.00. These match the balances sample.
- **Excluded:** 3 accounts, €7,786.12 Dr.

**Fixed during the walk-through:**
- **The tables were too wide for A4 when printed** (1,044px against 718px); now they are 699px.
- **The legend icons stretched to the chart width.**
- **The headline figures used the dimmed style.**
- **The KPI strip appeared twice.**

## Not checked (please do these)

- **A real PDF.** I can't open the print dialog from my browser tools, because it would block them.
  Instead I applied the page's own print rules on screen at A4 content width and measured:
  - the sidebar, top bar, pickers and buttons are hidden;
  - all text is black on white;
  - both tables are 699px wide, inside 700px;
  - the charts are 700px wide;
  - the report is about 1,640px tall, roughly two A4 pages.

  **Please print it once from the preview** (Print / save as PDF → Save as PDF, A4, portrait) and look
  at it. That is also the check before switching `REPORT_LIVE` on in `phase-3`.
- **Phone width.** The preview won't load inside a frame, and the browser window won't shrink.
  Sections stack and tables scroll in their own containers, by design, but I haven't seen it.
- **The look of the charts on screen.** My screenshot tool hangs on pages with large tables,
  including Compare, so I checked the charts by their numbers and sizes, not by eye. One screenshot
  of the report's header worked, earlier in the session.

## Rough edges

- **Headlines are always for the latest month,** as on the strip, even if you pick an earlier
  month. It says so under them.
- **The Trend chart's axis shows only the top value and €0,** plus the lowest value if it is a loss.
- **The month list is the last 24 months of actuals.**
- **Production keeps the placeholder** until the switch is on in `main`.
