// Budget from actuals (Phase 1, step 1D), browser side: the preview before fpa.create_budget_from_actuals
// runs, and the sign of an amount someone types. Pure functions.
//
// The preview works in display sign (revenue positive), from fpa.variance's actuals. The server works
// in the stored sign; the two agree because rounding is half away from zero, which is symmetric:
// round(-x) = -round(x), so turning the sign before or after rounding gives the same cents.
import { parseAmount } from './actualsImport';
import { toAmount, type Currency } from './money';
import { budgetFromActuals, upliftBasisPoints } from './rounding';

/** An uplift as typed ("5", "-2.5", "" for none): basis points, or the problem. */
export function parseUplift(text: string): { bp: bigint } | { problem: string } {
  const t = text.trim().replace(/%$/, '').trim();
  if (t === '') return { bp: 0n };
  try {
    return { bp: upliftBasisPoints(t) };
  } catch {
    return { problem: 'Enter a percentage from -100 to 1000, with at most two decimals.' };
  }
}

export interface LinePreview {
  /** The 12 actual months in display sign, cents. */
  actual: bigint[];
  /** The 12 budget months in display sign, cents, rounded as the server will. */
  budget: bigint[];
  actualTotal: bigint;
  budgetTotal: bigint;
}

/**
 * The budget each line will get: its 12 months of actuals times (1 + uplift), each month rounded to
 * cents and the last month taking the rest, so the months add up to the rounded annual figure.
 */
export function previewLine(actualCents: readonly bigint[], upliftBp: bigint): LinePreview {
  if (actualCents.length !== 12) throw new RangeError('A budget window is 12 months');
  const budget = budgetFromActuals(actualCents, upliftBp);
  const sum = (xs: readonly bigint[]) => xs.reduce((a, b) => a + b, 0n);
  return { actual: [...actualCents], budget, actualTotal: sum(actualCents), budgetTotal: sum(budget) };
}

/**
 * An amount typed on the budget screen, in display sign (revenue typed as a positive number), to the
 * stored text (trial-balance sign): stored = display sign × typed. Accepts the same forms as the
 * import (1,200.50, €1,200.50, (1,200.50) for a negative).
 */
export function storedFromTyped(text: string, displaySign: 1 | -1, currency: Currency): { amount: string } | { problem: string } {
  const r = parseAmount(text, currency);
  if ('problem' in r) return { problem: r.problem.charAt(0).toUpperCase() + r.problem.slice(1) };
  try {
    return { amount: toAmount(displaySign === 1 ? r.cents : -r.cents) };
  } catch {
    return { problem: 'The amount is too large.' };
  }
}
