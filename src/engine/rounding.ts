// Rounding rules for budgets (Peter's Phase 1 decision). Calculate at full precision; round only
// for storage and display, to cents (numeric(14,2)). When a year is spread over its months, every
// month but the last is rounded on its own and the last month takes whatever is left, so the months
// always add up exactly to the rounded annual figure.
//
// Rounding is half away from zero (0.005 -> 0.01, -0.005 -> -0.01), the same as Postgres round().
// fpa.create_budget_from_actuals applies the same rule in SQL; both are tested against
// db/tests/fixtures/rounding_cases.json. Exact integer arithmetic only: no floats.

/** n / d rounded to the nearest integer, halves away from zero. d must be positive. */
export function divRound(n: bigint, d: bigint): bigint {
  if (d <= 0n) throw new RangeError('The divisor must be positive');
  const abs = n < 0n ? -n : n;
  const q = (2n * abs + d) / (2n * d);
  return n < 0n ? -q : q;
}

const UPLIFT_RE = /^(-)?(\d{1,4})(?:\.(\d{1,2}))?$/;

/** An uplift percentage ("3.5", "-10", "0") as basis points (hundredths of a percent). From -100% to 1000%. */
export function upliftBasisPoints(pct: string): bigint {
  const m = UPLIFT_RE.exec(pct.trim());
  if (!m) throw new RangeError(`Not a percentage with at most two decimals: ${pct}`);
  const [, sign, whole = '0', frac = ''] = m;
  const bp = BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
  const signed = sign ? -bp : bp;
  if (signed < -10_000n || signed > 100_000n) throw new RangeError('The uplift must be from -100% to 1000%');
  return signed;
}

/** Splits `total` (in units of 1/den cent) over the months: each month rounded, the last takes the rest. */
function spreadExact(exactMonths: readonly bigint[], den: bigint): bigint[] {
  if (exactMonths.length === 0) return [];
  const annual = divRound(exactMonths.reduce((a, b) => a + b, 0n), den);
  const out = exactMonths.slice(0, -1).map(x => divRound(x, den));
  out.push(annual - out.reduce((a, b) => a + b, 0n));
  return out;
}

/**
 * A budget line from a window of monthly actuals (in cents), each month times (1 + uplift). Returns
 * cents per month; the months sum exactly to the rounded annual total.
 */
export function budgetFromActuals(actualCents: readonly bigint[], upliftBp: bigint): bigint[] {
  const factor = 10_000n + upliftBp;
  return spreadExact(actualCents.map(c => c * factor), 10_000n);
}

/** An annual figure (in cents) spread evenly over `months` months; the last month takes the rest. */
export function spreadAnnual(annualCents: bigint, months = 12): bigint[] {
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new RangeError(`Bad month count: ${months}`);
  const n = BigInt(months);
  return spreadExact(Array.from({ length: months }, () => annualCents), n);
}
