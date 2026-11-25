# KPI definitions

**Status: signed off by Peter, 25 Nov 2026, for Phase 1 only.** That covers Revenue (month) and Net
profit, with Cash balance and Runway shown as "—". The two cash-burn points below are **deferred to
Phase 2**. The KPI strip is live from that date. Written from Peter's Phase 1 decisions, 24 Nov 2026.

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
| **Cash balance** | The bank and cash balance at the last actuals date. | **"—"**. It needs balance-sheet data, which Phase 1 doesn't import |
| **Runway (months)** | Cash balance divided by the average monthly cash burn over the last three months. Shows "n/a" when the business isn't burning cash. | **"—"**, because it depends on Cash balance |

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

## Deferred to Phase 2 (Peter, 25 Nov 2026)

1. **Average monthly cash burn.** Proposed: the average fall in the cash balance over the last three
   complete months. The month-by-month change is used, so one-off movements count. **Deferred:** to
   be decided with the balance-sheet data in Phase 2 (see `docs/reports/P1-FINAL.md`, Phase 2 plan).
2. **"Not burning cash".** Proposed: the three-month average change in cash is zero or positive.
   **Deferred** to Phase 2.

Signed off: **Peter, 25 Nov 2026, for Phase 1 only.** That covers Revenue (month) and Net profit, with
Cash balance and Runway as "—". Points 1 and 2 above are deferred to Phase 2.
