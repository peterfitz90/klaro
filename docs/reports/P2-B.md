# P2-B: Phase 2 screens (2B), KPI sign-off, demo materials

Date: 26 Nov 2026. Branch: `phase-2`. Merged into `preview`; **not merged to main**.

**CI:** green on GitHub Actions, run
[45793876869](https://github.com/peterfitz90/klaro/actions/runs/45793876869) on `8e578fb`. There is
no pull request yet (I have no GitHub token). I added `phase-*` branches to the CI push trigger so
the branch is checked without one. Open the draft PR here:
https://github.com/peterfitz90/klaro/compare/main...phase-2?expand=1

0004 was applied first: see P2-A round 3.

## Screens

- **Connect → Import:**
  - A first question, "What does the file hold?": P&L movements (the default, unchanged) or
    month-end balances.
  - For balances: their own template and the sample. There are no questions about signs or YTD, and
    the "looks like YTD" warning is skipped.
  - Balances go to `fpa.import_balances`.
  - The preview warns, without blocking, when an account mapped to Cash and bank has no row for a
    month in the file.
  - The status line adds "Balances through [month]", and Recent imports gains a Type column.
  - "Months already imported" is now kept per kind, so a balances file is never warned about P&L
    months.
- **Map accounts:**
  - A new "Balance accounts" section with the choices Cash and bank and Not cash (left out).
    Suggestions are labelled, applied only on Use, and saved only on Save.
  - Cash and bank is no longer offered for P&L accounts.
  - Saving tells the KPI strip to reload.
- **KPI strip:**
  - **Cash balance:** "Balances through [month]", plus "Actuals through [month]" when it differs.
  - **Runway:** truncated to one decimal, with "€X/month net cash burn (includes loans and owner
    funding)".
  - "—" in every no-data state. `CASH_KPIS_LIVE = true`, from your sign-off (26 Nov).
  - The strip reloads after an import or a mapping save.
- **Plan:**
  - Hand edits are saved in one call to `fpa.save_budget_lines`.
  - If the save fails: "Nothing was saved. … Your N changes are still here", and a locked budget
    says so. This replaces the Gate 1 partial-save behaviour.
- **Demo mode** (`dev:demo`): the fake database supports all of the above.
- **Docs:**
  - `docs/kpi-definitions.md`: the cash KPIs, signed 26 Nov 2026, with a worked example;
  - `docs/demo-script.md`;
  - `docs/p2-review-checklist.md`.
- **Samples:** `public/samples/sample-balances.csv` (the demo data) and
  `sample-balances-broken.csv` (one bad month).

## Rule → test

| Rule | Test |
|---|---|
| Cash balance = Cash and bank accounts at the latest month with balances | `src/engine/cash.test.ts` (with the fixture shared with the 0004 test: entities C, D, E, A) |
| "Balances through" / "Actuals through" when they differ | cash.test.ts; kpi.test.tsx |
| Not set up → "—" + "Map your bank accounts to Cash and bank", never 0.00 or n/a | cash.test.ts; kpi.test.tsx |
| "Incomplete: N balance accounts unmapped" | cash.test.ts; kpi.test.tsx |
| Burn = (m−3 − m) ÷ 3; m shifts back when the latest month is the current one | cash.test.ts |
| "—" unless each of m−3 … m exists | cash.test.ts (gap; shifted window); kpi.test.tsx |
| Runway truncated, never rounded up; uses the exact burn | cash.test.ts (8.99 → 8.9; burn of 33.33⅓) |
| "n/a (not burning cash)"; "0.0" + "Cash is zero or overdrawn" | cash.test.ts |
| A failed or timed-out cash load → "—" everywhere and the §6 KPI wording | kpi.test.tsx |
| The balances import goes to `import_balances`; the broken file is refused with line numbers | import.test.tsx |
| The missing Cash and bank row warning (warn, not block), only for this connection | balances.test.ts; import.test.tsx |
| Months already imported are kept per kind | import.test.tsx |
| Cash and bank offered only for balance accounts; labelled suggestions; one save per source | map.test.tsx; balances.test.ts |
| All-or-nothing budget save; edits kept on failure; locked → PT423 wording; timeout wording | plan.test.tsx |
| The strip reloads after an import or a mapping save (this entity only) | kpi.test.tsx; map.test.tsx |

**Totals:** 321 tests pass locally, and in CI. Lint, typecheck, build and `check:bundle` are clean.

## What I walked through

- **Demo mode** (localhost, fake data), the full journey:
  - P&L sample → balances sample, which shows no false "replaced" warning;
  - Map accounts → Use all 3 suggestions → Save;
  - Plan tiles: **€95,400.00, 7.8, €12,150.00/month net cash burn (includes loans and owner
    funding)**;
  - map 9900 → build a budget → edit 2 cells → "Saved 2 changes".
  - Found and fixed: the demo fake ignored the sync-run kind and showed a false warning. The real
    database was not affected.
  - Phone width: 390px, no sideways scroll.
- **Preview** (klaro-preview.ledgrly.ie, real data), **read-only**. I imported nothing, saved
  nothing, and kept your demo data untouched:
  - **test 1:** Revenue €0.00, Net profit −€805.14, "1,249 accounts unmapped". The cash tiles say "No
    balances yet".
  - **Walkthrough Test 1:** Revenue **€65,024.39**, Net profit **€4,095.00**. The cash tiles say "No
    balances yet".
  - **Connect:** the status says "No month-end balances imported yet", and Recent imports shows the
    Type column.
  - **Balances sample:** checked but not imported. 36 balances, 3 accounts, Jan–Dec 2025, no
    warnings.
  - **Broken sample:** 3 problems on lines 17–19, and Import is disabled.
  - **Map accounts:** "Mapping complete", 17 accounts; the balance section says "No month-end
    balances imported yet".
  - **Compare:** no Cash and bank line; excluded total €6,936.49 Dr. The 2026 budget against Dec
    2025 shows "—" with "This budget has no lines in this year".

## For you to check (I have not done these)

- **Steps 4 to 8 of the demo script on the preview with the real database:**
  - the balances import;
  - the live mapping;
  - the cash tiles with real figures;
  - a real all-or-nothing save.

  I left the loading to the demo, as you asked. The same code passed in demo mode, and the database
  functions passed their tests (P2-A).
- **The checklist:** `docs/p2-review-checklist.md`.
- **Phone width** on a real phone.
- **Opening the draft PR** (link above).

## Rough edges

- **The balance section sits below the P&L accounts on Map accounts,** so you have to scroll. The
  demo script says so.
- **The Cash page is still a placeholder,** because the forecast is out of scope. It's on the "do
  not click" list.
- **Balances loaded in a rehearsal stay,** because nothing is deleted. A second run of the journey
  needs Walkthrough Test 2 (the script says how).
- **Production shows Phase 1 until you approve the merge to main.**
