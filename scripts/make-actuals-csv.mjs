// Writes made-up actuals CSV files for Klaro's CSV import (Phase 1). No real data: account names
// are generic and every amount comes from a fixed pseudo-random sequence, so the files are the same
// every time.
//   node scripts/make-actuals-csv.mjs sample  public/samples          sample + deliberately broken copy
//   node scripts/make-actuals-csv.mjs large   <folder> [rows=16000]   a large file (3 MB or more) for
//                                                                     the gateway test in the 1C checklist
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , kind, outDir, rowsArg] = process.argv;
if (!['sample', 'large'].includes(kind) || !outDir) {
  console.error('usage: node scripts/make-actuals-csv.mjs sample|large <folder> [rows]');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

let seed = 20251;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const amount = (base, spread) => (base * (1 + (rand() - 0.5) * spread)).toFixed(2);
const q = s => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const month = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const write = (name, lines) => {
  const p = join(outDir, name);
  writeFileSync(p, lines.join('\r\n') + '\r\n');
  console.log(`${p}: ${lines.length - 1} rows, ${statSync(p).size.toLocaleString('en-IE')} bytes`);
};

if (kind === 'sample') {
  // [code, name, typical monthly amount (trial-balance sign: credits negative), spread]
  const accounts = [
    ['4000', 'Sales - products', -42000, 0.3],
    ['4100', 'Sales - services', -18500, 0.4],
    ['5000', 'Purchases', 17800, 0.3],
    ['5100', 'Subcontractors', 4200, 0.6],
    ['6000', 'Wages and salaries', 21000, 0.05],
    ['6010', "Employer's PRSI", 2330, 0.05],
    ['6100', 'Advertising', 1500, 0.8],
    ['6200', 'Rent', 3250, 0],
    ['6210', 'Light and heat', 640, 0.5],
    ['6300', 'Telephone and internet', 210, 0.2],
    ['6310', 'Accountancy fees', 450, 0.3],
    ['6320', 'Bank charges', 38, 0.5],
    ['7000', 'Loan interest', 310, 0.1],
    ['1200', 'Bank current account', 2600, 3],
    ['2200', 'VAT control', -1900, 1],
    ['9900', 'Clearing 7', 75, 2],
  ];
  const lines = ['account_code,account_name,month,amount'];
  for (let m = 1; m <= 12; m++) {
    for (const [code, name, base, spread] of accounts) lines.push([code, q(name), month(2025, m), amount(base, spread)].join(','));
    if (m === 12) lines.push(['8000', 'Corporation tax', month(2025, 12), '9850.00'].join(','));
  }
  write('sample-actuals.csv', lines);

  // The same file with five deliberate mistakes, for checking the error list.
  const broken = [...lines];
  broken[3] = broken[3].replace('2025-01', '2025-13');                  // not a month
  broken[5] = broken[5].replace(/,[-\d.]+$/, ',€120.00');              // currency sign
  broken[8] = broken[8].replace(/^\d+,/, ',');                          // no account code
  broken.splice(10, 0, broken[9]);                                     // the same account and month twice
  broken[20] = broken[20].replace(/,[-\d.]+$/, ',1.234');              // three decimals
  write('sample-actuals-broken.csv', broken);
} else {
  const rows = Number(rowsArg ?? 16000);
  const months = [];
  for (let y = 2025, m = 1; months.length < 20; m++) { if (m > 12) { m = 1; y++; } months.push(month(y, m)); }
  const accounts = Math.ceil(rows / months.length);
  const filler = 'made-up account used only to test a large import through the web gateway; the name is long on purpose so that the whole file comes to more than three megabytes in size';
  const lines = ['account_code,account_name,month,amount'];
  for (const mo of months) {
    for (let a = 1; a <= accounts && lines.length <= rows; a++) {
      const code = String(10000 + a);
      lines.push([code, q(`Account ${code} ${filler}`.slice(0, 186)), mo, amount(a % 2 ? 900 : -1100, 0.8)].join(','));
    }
  }
  write(`large-actuals-${rows}.csv`, lines);
}
