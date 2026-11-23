import { expect, it } from 'vitest';
import { toCsv } from './downloadCSV';

it('quotes every cell and escapes quotes', () => {
  expect(toCsv([['Ref', 'Name'], ['ABC', 'O"Brien'], [1250, null]])).toBe('"Ref","Name"\r\n"ABC","O""Brien"\r\n"1250",""');
});
