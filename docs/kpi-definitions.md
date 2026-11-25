# KPI definitions (draft for Peter's sign-off)

**Status: DRAFT, not signed off.** The KPI strip stays on placeholders until Peter signs this off
(Phase 1, step 1E). Written from Peter's Phase 1 decisions, 24 Nov 2026.

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

## The wiring (built in 1E, not switched on)

- **Built and tested:**
  - the rules above, as `src/engine/kpi.ts`, tested in `kpi.test.ts`;
  - the live strip, as `src/features/kpi/LiveKpiStrip.tsx`, tested in `kpi.test.tsx`.
- **Switched off:** the shell still shows the placeholder strip ("—" everywhere), because
  `KPI_STRIP_LIVE` in `src/app/shell/kpiSwitch.ts` is `false`. A test checks that it stays off.
- **To switch it on after your sign-off:** set `KPI_STRIP_LIVE` to `true` and fill in the sign-off line
  below.
- **If the strip's figures fail to load,** every tile shows "—" and says why; it never shows a zero.
  Its timeout wording is still to be confirmed (`docs/ui-rules.md` §6).

## Open points for Peter

1. **Average monthly cash burn.** Proposed: the average fall in the cash balance over the last three
   complete months. The month-by-month change is used, so one-off movements count. This needs
   confirming before cash data arrives (Phase 2).
2. **"Not burning cash".** Proposed: the three-month average change in cash is zero or positive.

Signed off: ______ (Peter), date ______
