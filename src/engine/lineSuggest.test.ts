import { describe, expect, it } from 'vitest';
import { suggestLine } from './lineSuggest';

describe('suggestLine', () => {
  it.each([
    ['Sales - products', 'revenue'],
    ['Turnover', 'revenue'],
    ['Cost of sales', 'cost_of_sales'],
    ['Purchases', 'cost_of_sales'],
    ['Wages and salaries', 'payroll'],
    ["Employer's PRSI", 'payroll'],
    ['Advertising', 'marketing'],
    ['Rent', 'premises'],
    ['Light and heat', 'premises'],
    ['Telephone and internet', 'other_operating'],
    ['Bank charges', 'other_operating'],
    ['Loan interest', 'interest'],
    ['Corporation tax', 'tax'],
    ['Bank current account', 'excluded'],
    ['VAT control', 'excluded'],
    ['PRSI payable', 'excluded'],
    ['Revenue Commissioners', 'excluded'],
    ['Trade debtors', 'excluded'],
  ])('%s → %s', (name, line) => {
    expect(suggestLine(name)).toBe(line);
  });
  it('suggests nothing when no word fits, or there is no name', () => {
    expect(suggestLine('Clearing 7')).toBeNull();
    expect(suggestLine('')).toBeNull();
    expect(suggestLine(null)).toBeNull();
  });
});
