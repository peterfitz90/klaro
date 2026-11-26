// The KPI strip shows live figures only once Peter has signed off docs/kpi-definitions.md (Phase 1,
// step 1E). Signed off by Peter on 25 Nov 2026, for Phase 1 only: Revenue (month) and Net profit
// live; Cash balance and Runway "—". Setting this to false brings back the placeholder strip.
export const KPI_STRIP_LIVE = true;

// Phase 2: Cash balance, net cash burn and Runway (src/engine/cash.ts). Signed off by Peter on
// 26 Nov 2026, for the prototype (docs/kpi-definitions.md). Setting this to false shows those two
// tiles as "—" with "Waiting for sign-off" and leaves Revenue and Net profit as they are.
export const CASH_KPIS_LIVE = true;
