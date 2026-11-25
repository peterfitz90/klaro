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
  /** null shows "—". */
  cents: bigint | null;
  notes: string[];
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
