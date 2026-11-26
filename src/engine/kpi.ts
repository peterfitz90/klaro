// The KPI strip's rules (docs/kpi-definitions.md), as a pure function. The strip is wired to this, but
// it stays on placeholders until Peter signs that document off (src/app/shell/kpiSwitch.ts).
//
// - Revenue (month): the Revenue line for the latest month of actuals, display sign.
// - Net profit: the Net profit line for that month (revenue less all costs; unmapped and excluded
//   accounts left out).
// - Cash balance and Runway: "—" in Phase 1 (they need balance-sheet data).
// - Every KPI says "actuals through [month]"; with no data it shows "—", never zero.
// - While any account is unmapped, the profit figures are marked incomplete, with how many.
// - If the latest month of actuals is this calendar month: "month may be incomplete" beside Revenue
//   (month) and Net profit.
import type { CashKpis } from './cash';
import type { Period } from './period';

export interface KpiInput {
  /** The latest month with actuals (the latest actuals_through across connections), or null. */
  latestMonth: Period | null;
  /** This calendar month. */
  currentMonth: Period;
  /** Revenue and Net profit for latestMonth, display sign, cents (null if not known). */
  revenue: bigint | null;
  netProfit: bigint | null;
  /** Accounts with actuals but no plan line. */
  unmappedAccounts: number;
}

export interface KpiTile {
  label: 'Revenue (month)' | 'Net profit' | 'Cash balance' | 'Runway (months)';
  /** null shows "—" (unless `text` is set). */
  cents: bigint | null;
  /** A figure that is not money (Runway: "7.4", "0.0", "n/a (not burning cash)"). */
  text?: string | null;
  notes: string[];
}

/**
 * Phase 2: puts the Cash balance and Runway tiles from src/engine/cash.ts in place of the Phase 1
 * placeholders. `cash` null means the cash KPIs are switched off (CASH_KPIS_LIVE): "—" with
 * "Waiting for sign-off".
 */
export function withCashTiles(tiles: readonly KpiTile[], cash: CashKpis | null): KpiTile[] {
  return tiles.map(t => {
    if (t.label !== 'Cash balance' && t.label !== 'Runway (months)') return t;
    if (!cash) return { label: t.label, cents: null, text: null, notes: ['Waiting for sign-off'] };
    const c = t.label === 'Cash balance' ? cash.cash : cash.runway;
    return { label: t.label, cents: c.cents, text: c.text, notes: c.notes };
  });
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const label = (p: Period) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export function kpiTiles(input: KpiInput): { tiles: KpiTile[]; stripNote: string | null } {
  const { latestMonth } = input;
  const through = latestMonth ? `Actuals through ${label(latestMonth)}` : 'No actuals yet';
  const incomplete = latestMonth !== null && latestMonth === input.currentMonth ? ['Month may be incomplete'] : [];
  const unmapped = input.unmappedAccounts > 0
    ? [`Incomplete: ${input.unmappedAccounts.toLocaleString('en-IE')} account${input.unmappedAccounts === 1 ? '' : 's'} unmapped`] : [];
  const live = (v: bigint | null) => (latestMonth === null ? null : v);
  return {
    tiles: [
      { label: 'Revenue (month)', cents: live(input.revenue), notes: [through, ...incomplete] },
      { label: 'Net profit', cents: live(input.netProfit), notes: [through, ...incomplete, ...unmapped] },
      { label: 'Cash balance', cents: null, notes: [through, 'Needs balance-sheet data (not in Phase 1)'] },
      { label: 'Runway (months)', cents: null, notes: [through, 'Needs the cash balance (not in Phase 1)'] },
    ],
    stripNote: unmapped.length && latestMonth
      ? `The profit figures are incomplete: ${input.unmappedAccounts.toLocaleString('en-IE')} account${input.unmappedAccounts === 1 ? ' is' : 's are'} unmapped.` : null,
  };
}
