// Display helpers for Connect. Amounts here are in trial-balance sign (debit positive), so they are
// shown as "Dr" or "Cr" rather than with a sign a reader could misread.
import { addMonths, formatMoney, type Currency, type Period } from '../../engine';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jan 2025" from "2025-01-01". */
export function monthLabel(p: Period): string {
  return `${MONTH_NAMES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`;
}

/** "Jan 2025 to Dec 2025 (12 months)", or the months listed when they are not one run. */
export function monthsSummary(months: readonly Period[]): string {
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return 'none';
  if (sorted.length === 1) return monthLabel(first);
  const contiguous = sorted.every((p, i) => i === 0 || addMonths(sorted[i - 1] ?? p, 1) === p);
  if (contiguous) return `${monthLabel(first)} to ${monthLabel(last)} (${sorted.length} months)`;
  if (sorted.length <= 12) return sorted.map(monthLabel).join(', ');
  return `${sorted.length} months from ${monthLabel(first)} to ${monthLabel(last)}, with gaps`;
}

/** "€1,200.50 Dr", "€80.00 Cr" or "€0.00". */
export function drCr(cents: bigint, currency: Currency): string {
  if (cents === 0n) return formatMoney(0n, currency);
  return `${formatMoney(cents < 0n ? -cents : cents, currency)} ${cents > 0n ? 'Dr' : 'Cr'}`;
}

/** "25 Nov 2026, 09:03" in the viewer's own time zone. */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`;
}
