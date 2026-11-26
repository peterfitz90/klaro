# KPI definitions

**Status:**
- **Revenue (month) and Net profit:** signed off by Peter, 25 Nov 2026 (Phase 1).
- **Cash balance, net cash burn and Runway:** signed off by Peter, **26 Nov 2026, for the prototype**
  (Phase 2), exactly as set out below. They follow his Phase 2 decisions 2 to 4 and the answers
  recorded in `docs/reports/P2-A.md`, round 2.
- The strip is live: `KPI_STRIP_LIVE` from 25 Nov, and `CASH_KPIS_LIVE` from 26 Nov 2026.

## Rules for every KPI

- Each KPI shows **"actuals through [month]"**: the latest month with actuals for the entity.
- With no data, a KPI shows **"—"**, never zero.
- Figures use the display sign: revenue and profit are positive, and a loss is negative.
- Figures are calculated at full precision and rounded to cents only for display.
- While any account is unmapped, the strip says the profit figures are incomplete, and how many
  accounts are unmapped.
- If the latest month of actuals is the current calendar month, Revenue (month) and Net profit
  show **"month may be incomplete"** beside the figure (Peter, 24 Nov 2026).

## The four KPIs

| KPI | Definition | Phase 1 |
|---|---|---|
| **Revenue (month)** | Revenue for the latest month of actuals: the Revenue line in display sign. | Live |
| **Net profit** | Revenue less all costs for that same month: the Net profit line. That is Revenue less Cost of sales, Payroll, Marketing, Rent and premises, Other operating costs, Interest and Tax. Unmapped and excluded accounts are left out. | Live |
| **Cash balance** | See "Cash balance, net cash burn and Runway" below. | Phase 1: "—". **Live from 26 Nov 2026** |
| **Runway (months)** | See below. | Phase 1: "—". **Live from 26 Nov 2026** |

## Where the numbers come from

- Revenue and Net profit come from `fpa.variance(entity, NULL, month, month)` for the latest month
  with actuals.
- That month is the latest `actuals_through` across the entity's connections.

## The wiring (built in 1E, switched on 25 Nov 2026)

- **Built and tested:**
  - the rules above, as `src/engine/kpi.ts`, tested in `kpi.test.ts`;
  - the live strip, as `src/features/kpi/LiveKpiStrip.tsx`, tested in `kpi.test.tsx`.
- **Switched on** after Peter's sign-off: `KPI_STRIP_LIVE = true` in `src/app/shell/kpiSwitch.ts`. A
  test checks the switch, and the shell's tests check that a page shows the live strip.
- **If the strip's figures fail to load,** every tile shows "—" and says why; it never shows a zero.
  Its timeout wording, "This took too long. Try again, and if it keeps happening, tell us.", is
  confirmed by Peter, 25 Nov 2026 (`docs/ui-rules.md` §6).

## Cash balance, net cash burn and Runway (Phase 2; signed off by Peter, 26 Nov 2026, for the prototype)

They are worked out in `src/engine/cash.ts` from what `fpa.cash_position` returns. The engine and
the database test share the fixture `db/tests/fixtures/cash_position_cases.json`.

- **Where the figures come from: month-end (closing) balances.**
  - They are imported on Connect as "Month-end balances", one row per account per month-end.
  - They are stored in trial-balance sign (debits positive), so money in the bank is positive and an
    overdraft negative.
  - Figures are exact to the cent.
- **Cash balance:**
  - It is the sum of the closing balances of the accounts mapped to **Cash and bank**, at the
    **latest month with balances**, in display sign.
  - The tile says "**Balances through [month]**", and also "**Actuals through [month]**" when the
    latest month of actuals is different.
- **Not set up:**
  - This applies when no account mapped to Cash and bank has a balance in that month. That includes
    when every balance account is unmapped or left out.
  - Cash balance and Runway then show **"—"** with "**Map your bank accounts to Cash and bank**".
  - They never show 0.00 or "n/a" in that state.
- **No balances imported:** Cash balance and Runway show "—" with "No balances yet".
- **Incomplete:** while any balance account in the latest month is unmapped, the Cash tile says
  "**Incomplete: N balance accounts unmapped**".
- **Net cash burn = (cash at the end of month m−3 − cash at the end of month m) ÷ 3.**
  - Month m is the latest month with balances, or the month before it if that is the current
    calendar month.
  - It is labelled "**net cash burn (includes loans and owner funding)**": a loan received or
    repaid, or money put in or taken out by the owners, changes it.
  - It is shown on the Runway tile as a monthly amount, rounded to the cent for display only.
- **Runway = Cash balance ÷ net cash burn**, to one decimal, **truncated (never rounded up)**.
  - It is worked out from the exact (unrounded) burn.
  - It shows **"—"** unless month-end balances exist for **each** of m−3, m−2, m−1 and m. The tile
    then says which months it needs.
  - It shows **"n/a (not burning cash)"** when the three-month change in cash is zero or positive.
  - It shows **"0.0"** with "**Cash is zero or overdrawn**" when cash is being burnt and the Cash
    balance is zero or below.
- **If the cash figures fail to load,** every tile shows "—" and says why; it never shows a zero.
  The timeout wording is "This took too long. Try again, and if it keeps happening, tell us."
  (`docs/ui-rules.md` §6).

**Worked example:** the demo sample, `public/samples/sample-balances.csv`, with 1210 and 1220 mapped
to Cash and bank.

| | Value |
|---|---|
| Cash at the end of Dec 2025 | 87,150.00 + 8,250.00 = **95,400.00** |
| Cash at the end of Sep 2025 | 123,600.00 + 8,250.00 = 131,850.00 |
| Net cash burn | (131,850.00 − 95,400.00) ÷ 3 = **12,150.00 a month** |
| Runway | 95,400.00 ÷ 12,150.00 = 7.85, which truncates to **7.8 months** |

Signed off: **Peter, 26 Nov 2026, for the prototype.** This covers Cash balance, net cash burn and
Runway as defined in this section.

## Deferred to Phase 2 (Peter, 25 Nov 2026): now decided above

1. **Average monthly cash burn.** Proposed: the average fall in the cash balance over the last three
   complete months. The month-by-month change is used, so one-off movements count. **Deferred:** to
   be decided with the balance-sheet data in Phase 2 (see `docs/reports/P1-FINAL.md`, Phase 2 plan).
2. **"Not burning cash".** Proposed: the three-month average change in cash is zero or positive.
   **Deferred** to Phase 2.

Signed off: **Peter, 25 Nov 2026, for Phase 1 only.** That covers Revenue (month) and Net profit, with
Cash balance and Runway as "—". Points 1 and 2 above are deferred to Phase 2.
