// Cash balance, net cash burn and Runway (Peter's Phase 2 decisions; docs/kpi-definitions.md, signed
// off 26 Nov 2026). Inputs are the rows of fpa.cash_position, which only gathers figures; every rule
// is here. Exact integer cents, no floats.
//
// - Cash balance: the sum of the closing balances of accounts mapped to Cash and bank, at the latest
//   month with balances, display sign. Labelled "Balances through [month]", and also "Actuals
//   through [month]" when that differs.
// - Not set up (no account mapped to Cash and bank with a balance in that month): Cash balance and
//   Runway show "—" with "Map your bank accounts to Cash and bank". Never 0.00 or "n/a".
// - While any balance account in the latest month is unmapped, the Cash tile says
//   "Incomplete: N balance accounts unmapped".
// - Net cash burn = (cash at the end of month m−3 − cash at the end of month m) ÷ 3, where m is the
//   latest month with balances, or the month before it if that is the current calendar month. It
//   includes loans and owner funding, and is labelled so.
// - Runway = Cash balance ÷ net cash burn, to one decimal, truncated (never rounded up).
//   "—" unless balances exist for each of m−3, m−2, m−1 and m. "n/a (not burning cash)" when the
//   three-month change is zero or positive. "0.0" with "Cash is zero or overdrawn" when burning cash
//   with the Cash balance at or below zero.
import { formatMoney, type Currency } from './money';
import { addMonths, type Period } from './period';
import { divRound } from './rounding';

/** One row of fpa.cash_position, converted (cash in cents; null when the month was never imported). */
export interface CashRow {
  latestMonth: Period;
  monthsAvailable: number;
  unmappedAccounts: number;
  cashAccounts: number;
  month: Period;
  hasBalances: boolean;
  cash: bigint | null;
}

export interface CashTile {
  /** Money figure (cents) or null; a Runway figure is in `text` instead. */
  cents: bigint | null;
  /** Non-money figure ("7.4", "0.0", "n/a (not burning cash)"); null with cents null shows "—". */
  text: string | null;
  notes: string[];
}

export interface CashKpis {
  cash: CashTile;
  runway: CashTile;
  /** Net cash burn per month, rounded to cents for display (positive = cash falling); null if not worked out. */
  burnCents: bigint | null;
  /** The month m the burn ends at, when worked out. */
  burnMonth: Period | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (p: Period) => `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;

export const NOT_SET_UP = 'Map your bank accounts to Cash and bank';
export const BURN_LABEL = 'net cash burn (includes loans and owner funding)';

export function cashKpis(rows: readonly CashRow[], opts: { currentMonth: Period; actualsThrough: Period | null; currency: Currency }): CashKpis {
  const [head] = rows;
  if (!head) {
    const none = { cents: null, text: null, notes: ['No balances yet'] };
    return { cash: none, runway: { ...none, notes: [...none.notes] }, burnCents: null, burnMonth: null };
  }
  const latest = head.latestMonth;
  const through = [`Balances through ${monthLabel(latest)}`];
  if (opts.actualsThrough && opts.actualsThrough !== latest) through.push(`Actuals through ${monthLabel(opts.actualsThrough)}`);
  const unmapped = head.unmappedAccounts > 0
    ? [`Incomplete: ${head.unmappedAccounts.toLocaleString('en-IE')} balance account${head.unmappedAccounts === 1 ? '' : 's'} unmapped`] : [];

  if (head.cashAccounts === 0) {
    return {
      cash: { cents: null, text: null, notes: [NOT_SET_UP, ...through, ...unmapped] },
      runway: { cents: null, text: null, notes: [NOT_SET_UP, ...through] },
      burnCents: null, burnMonth: null,
    };
  }

  const at = new Map(rows.map(r => [r.month, r]));
  const balance = at.get(latest)?.cash ?? null;
  if (balance === null) throw new RangeError('cash_position: the latest month has no cash figure');
  const cash: CashTile = { cents: balance, text: null, notes: [...through, ...unmapped] };

  const m = latest === opts.currentMonth ? addMonths(latest, -1) : latest;
  const start = addMonths(m, -3);
  const cashAt = (p: Period): bigint | null => { const r = at.get(p); return r && r.hasBalances ? r.cash : null; };
  const values = [start, addMonths(m, -2), addMonths(m, -1), m].map(cashAt);
  const first = cashAt(start), last = cashAt(m);
  if (values.some(v => v === null) || first === null || last === null) {
    return {
      cash,
      runway: { cents: null, text: null, notes: [`Needs month-end balances for each month ${monthLabel(start)} to ${monthLabel(m)}`, ...through] },
      burnCents: null, burnMonth: null,
    };
  }
  const fall = first - last; // three months' fall in cash
  const span = `Over ${monthLabel(start)} to ${monthLabel(m)}`;
  if (fall <= 0n) {
    return { cash, runway: { cents: null, text: 'n/a (not burning cash)', notes: [span, ...through] }, burnCents: divRound(fall, 3n), burnMonth: m };
  }
  const burn = divRound(fall, 3n);
  const burnNote = `${formatMoney(burn, opts.currency)}/month ${BURN_LABEL}`;
  if (balance <= 0n) {
    return { cash, runway: { cents: null, text: '0.0', notes: ['Cash is zero or overdrawn', burnNote, span, ...through] }, burnCents: burn, burnMonth: m };
  }
  // balance ÷ (fall ÷ 3), in tenths, truncated: exact integer division of positive numbers.
  const tenths = (30n * balance) / fall;
  return {
    cash,
    runway: { cents: null, text: `${tenths / 10n}.${tenths % 10n}`, notes: [burnNote, span, ...through] },
    burnCents: burn, burnMonth: m,
  };
}
