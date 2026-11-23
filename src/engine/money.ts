// Money in the engine is held as integer cents (bigint): no floats anywhere. The database stores
// numeric(14,2) in the entity's currency. PostgREST returns numeric as a JSON number or string;
// both go through toCents, which refuses anything that is not an exact two-decimal amount.

export type Currency = 'EUR' | 'GBP';

/** Largest absolute amount numeric(14,2) can hold, in cents. */
export const MAX_CENTS = 99_999_999_999_999n;

const AMOUNT_RE = /^(-)?(\d{1,12})(?:\.(\d{1,2}))?$/;

/** Exact conversion of a database amount to cents. Throws on anything ambiguous. */
export function toCents(value: string | number): bigint {
  const text = typeof value === 'number' ? numberText(value) : value.trim();
  const m = AMOUNT_RE.exec(text);
  if (!m) throw new RangeError(`Not an amount with at most two decimals: ${String(value)}`);
  const [, sign, whole = '0', frac = ''] = m;
  const cents = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  return sign ? -cents : cents;
}

function numberText(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`Not a finite amount: ${n}`);
  // Up to 14 significant digits survive a double exactly; toFixed(2) then must round-trip.
  const fixed = n.toFixed(2);
  if (Number(fixed) !== n) throw new RangeError(`Amount has more than two decimals: ${n}`);
  return fixed;
}

/** Cents back to the database's text form, for writes ("1234.50"). */
export function toAmount(cents: bigint): string {
  if (cents > MAX_CENTS || cents < -MAX_CENTS) throw new RangeError('Amount is too large for numeric(14,2)');
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Display form, e.g. "€1,234.50" or "-£20.00". */
export function formatMoney(cents: bigint, currency: Currency): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${currency === 'EUR' ? '€' : '£'}${whole}.${frac}`;
}

export function sumCents(values: readonly bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}
