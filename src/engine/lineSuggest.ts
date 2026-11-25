// Suggested plan line for an account, from words in its name (Phase 1, step 1C). Only a suggestion:
// the mapping screen shows it next to the account and applies it only when the user says so.
// Returns null when nothing fits clearly; a wrong suggestion is worse than none.

export type MappableLine =
  | 'revenue' | 'cost_of_sales' | 'payroll' | 'marketing' | 'premises' | 'other_operating'
  | 'interest' | 'tax' | 'excluded';

/** Checked in order; the first rule whose pattern matches the name wins. */
const RULES: ReadonlyArray<[RegExp, MappableLine]> = [
  // Balances owed or owing (tax and payroll control accounts too) are not in the P&L.
  [/\b(payable|liability|control|receivable|revenue commissioners|hmrc)\b/i, 'excluded'],
  [/\b(corporation tax|income tax expense|tax charge)\b/i, 'tax'],
  [/\b(interest)\b/i, 'interest'],
  [/\b(bank charges|bank fees)\b/i, 'other_operating'],
  // Balance-sheet accounts are not in the P&L.
  [/\b(bank|cash at|petty cash|debtors?|creditors?|vat|accruals?|prepayments?|fixed assets?|accumulated depreciation|loans?|directors?'? (current|loan)|share capital|retained|reserves?|suspense|stock on hand|inventory)\b/i, 'excluded'],
  [/\b(cost of sales|cost of goods|cogs|purchases|materials|direct costs?|subcontract\w*)\b/i, 'cost_of_sales'],
  [/\b(sales|revenue|turnover|fees? income|income from)\b/i, 'revenue'],
  [/\b(wages?|salar(y|ies)|payroll|prsi|employer'?s? (ni|pension)|pensions?|staff costs?|bonus(es)?)\b/i, 'payroll'],
  [/\b(advertising|marketing|promotion|sponsorship)\b/i, 'marketing'],
  [/\b(rent|rates|premises|light and heat|electricity|heating|service charge|repairs and maintenance)\b/i, 'premises'],
  [/\b(insurance|telephone|phone|internet|software|subscriptions?|postage|stationery|printing|travel|motor|accountancy|legal|professional fees|bank charges|sundry|general expenses|office|training|entertainment|cleaning)\b/i, 'other_operating'],
];

export function suggestLine(name: string | null | undefined): MappableLine | null {
  if (!name) return null;
  const n = name.trim();
  if (!n) return null;
  for (const [re, line] of RULES) if (re.test(n)) return line;
  return null;
}
