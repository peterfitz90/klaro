// Writes made-up actuals CSV files for Klaro's CSV import (Phase 1). No real data: account names
// are generic and every amount comes from a fixed pseudo-random sequence, so the files are the same
// every time.
//   node scripts/make-actuals-csv.mjs sample <folder>
//       the sample and its deliberately broken copy (public/samples)
//   node scripts/make-actuals-csv.mjs large <folder> [--accounts N] [--months N] [--name-length N]
//       a large file for the gateway test in the 1C checklist: N accounts, each with a row for every
//       month from January 2025. The defaults (800 accounts, 20 months) give large-actuals-16000.csv,
//       16,000 rows and 3,279,781 bytes. For the paging test past 1,000 accounts:
//         --accounts 1250 --months 12 --name-length 200   (15,000 rows, over 3 MB)
//       It prints the file size and the size the database will measure (its limit is 5 MB).
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , kind, outDir, ...rest] = process.argv;
const flags = {};
for (let i = 0; i < rest.length; i += 2) {
  const k = rest[i], v = Number(rest[i + 1]);
  if (!['--accounts', '--months', '--name-length'].includes(k) || !Number.isInteger(v) || v < 1) {
    console.error(`unknown or bad option: ${k} ${rest[i + 1] ?? ''}`);
    process.exit(1);
  }
  flags[k] = v;
}
if (!['sample', 'large'].includes(kind) || !outDir) {
  console.error('usage: node scripts/make-actuals-csv.mjs sample|large <folder> [--accounts N] [--months N] [--name-length N]');
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
  broken[5] = broken[5].replace(/,[-\d.]+$/, ',$120.00');              // a currency sign Klaro refuses
  broken[8] = broken[8].replace(/^\d+,/, ',');                          // no account code
  broken.splice(10, 0, broken[9]);                                     // the same account and month twice
  broken[20] = broken[20].replace(/,[-\d.]+$/, ',1.234');              // three decimals
  write('sample-actuals-broken.csv', broken);
} else {
  const accounts = flags['--accounts'] ?? 800;
  const monthCount = flags['--months'] ?? 20;
  const nameLength = flags['--name-length'] ?? null;
  if (accounts > 89999 || monthCount > 22 || (nameLength !== null && nameLength > 200)) {
    console.error('at most 89,999 accounts, 22 months (to October 2026) and names of 200 characters');
    process.exit(1);
  }
  const months = [];
  for (let y = 2025, m = 1; months.length < monthCount; m++) { if (m > 12) { m = 1; y++; } months.push(month(y, m)); }
  const filler = 'made-up account used only to test a large import through the web gateway; the name is long on purpose so that the whole file comes to more than three megabytes in size';
  // Without --name-length the names are exactly as in the first large file (so it can be made again).
  const nameOf = code => {
    const base = `Account ${code} ${filler}`;
    return nameLength === null ? base.slice(0, 186) : `${base} ${base}`.slice(0, nameLength).trimEnd();
  };
  const lines = ['account_code,account_name,month,amount'];
  const payload = [];
  for (const mo of months) {
    for (let a = 1; a <= accounts; a++) {
      const code = String(10000 + a);
      const row = [code, nameOf(code), mo, amount(a % 2 ? 900 : -1100, 0.8)];
      lines.push([row[0], q(row[1]), row[2], row[3]].join(','));
      payload.push({ account_code: row[0], account_name: row[1], month: `${row[2]}-01`, amount: row[3] });
    }
  }
  const rows = lines.length - 1;
  const name = flags['--accounts'] || flags['--months'] || nameLength !== null
    ? `large-actuals-${accounts}-accounts-${monthCount}-months.csv` : `large-actuals-${rows}.csv`;
  write(name, lines);
  // octet_length(jsonb::text), as src/engine/actualsImport.ts jsonbTextBytes: ": " and ", " separators.
  const bytes = Buffer.byteLength(JSON.stringify(payload)) + payload.length * 7 + payload.length - 1;
  const size = statSync(join(outDir, name)).size;
  console.log(`  ${accounts.toLocaleString('en-IE')} accounts x ${monthCount} months; file ${(size / 1048576).toFixed(2)} MiB (${size >= 3_145_728 ? 'over' : 'UNDER'} 3 MiB); rows as the database measures them ${bytes.toLocaleString('en-IE')} bytes (${bytes <= 5_242_880 ? 'under' : 'OVER'} the 5 MB limit)`);
}
