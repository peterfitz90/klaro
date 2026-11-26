// The KPI strip shows live figures only once Peter has signed off docs/kpi-definitions.md (Phase 1,
// step 1E). Signed off by Peter on 25 Nov 2026, for Phase 1 only: Revenue (month) and Net profit
// live; Cash balance and Runway "—". Setting this to false brings back the placeholder strip.
export const KPI_STRIP_LIVE = true;

// Phase 2: Cash balance, net cash burn and Runway (src/engine/cash.ts). Signed off by Peter on
// 26 Nov 2026, for the prototype (docs/kpi-definitions.md). Setting this to false shows those two
// tiles as "—" with "Waiting for sign-off" and leaves Revenue and Net profit as they are.
export const CASH_KPIS_LIVE = true;

// Phase 3 slice: the Scenarios panel on Plan (src/features/plan/ScenariosPanel.tsx). Off until its own
// walk-through passed (Peter, 26 Nov 2026); it passed on the preview on 26 Nov 2026
// (docs/reports/P3-LITE.md), so it is on. When false, nothing of it is shown.
export const SCENARIOS_LIVE = true;

// Phase 3: the monthly report on Report (src/features/report/ReportPage.tsx). Its walk-through on the
// preview passed and the review was done (26 Nov 2026), so it is on; Peter checks the PDF print in
// parallel. When false, Report shows its placeholder.
export const REPORT_LIVE = true;

// Phase 4: the Cash page (src/features/cash/CashPage.tsx). Off until its own browser walk-through passes
// (Peter, 26 Nov 2026). When false, Cash shows its placeholder.
export const CASH_PAGE_LIVE = false;
