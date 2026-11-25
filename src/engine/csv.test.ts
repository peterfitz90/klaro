import { describe, expect, it } from 'vitest';
import { CsvSyntaxError, isBlankRow, parseCsv } from './csv';

describe('parseCsv', () => {
  it('reads plain rows with LF or CRLF line ends and keeps each row’s line number', () => {
    expect(parseCsv('a,b\n1,2\r\n3,4')).toEqual([
      { line: 1, cells: ['a', 'b'] },
      { line: 2, cells: ['1', '2'] },
      { line: 3, cells: ['3', '4'] },
    ]);
  });
  it('drops a byte-order mark and a final line end, keeps empty cells', () => {
    expect(parseCsv('﻿a,,c\n')).toEqual([{ line: 1, cells: ['a', '', 'c'] }]);
  });
  it('reads quoted fields with commas, doubled quotes and line breaks', () => {
    const rows = parseCsv('code,name\n4000,"Sales, retail ""shop"""\n4010,"two\nlines"\n4020,x');
    expect(rows[1]?.cells).toEqual(['4000', 'Sales, retail "shop"']);
    expect(rows[2]).toEqual({ line: 3, cells: ['4010', 'two\nlines'] });
    expect(rows[3]).toEqual({ line: 5, cells: ['4020', 'x'] });
  });
  it('refuses a quote that is never closed or is misplaced, naming the line', () => {
    expect(() => parseCsv('a\n"open')).toThrow(CsvSyntaxError);
    expect(() => parseCsv('a\n"open')).toThrow('Line 2');
    expect(() => parseCsv('a\nab"c')).toThrow('Line 2');
    expect(() => parseCsv('a\n"ab"c')).toThrow('Line 2');
  });
  it('knows a blank row', () => {
    expect(isBlankRow({ line: 1, cells: ['', ' ', ''] })).toBe(true);
    expect(isBlankRow({ line: 1, cells: ['', '0'] })).toBe(false);
  });
});
