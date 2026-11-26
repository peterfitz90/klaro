// CSV import (Phase 1, step 1B): choose a file, match its columns, answer two questions about its
// numbers, check every row in the browser, then import in one transaction on the server.
// Phase 2: the first question is what the file holds. P&L movements go to fpa.import_actuals as
// before; month-end balances (trial-balance sign, no questions about the numbers) go to
// fpa.import_balances, and the preview warns (never blocks) when an account already mapped to Cash
// and bank has no row for a month in the file.
// Fails closed: nothing is sent while any row has a problem, an error is never shown as success,
// and an import whose outcome is unknown says so (docs/ui-rules.md sections 3 and 6).
import { useId, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  columnMapProblems, CsvSyntaxError, FIELD_LABELS, FIELDS, guessColumns, IMPORT_LIMITS, missingCashRows, missingCashText, monthOf, parseCsv, prepareImport,
  type ColumnMap, type CsvRow, type Currency, type Period, type Prepared,
} from '../../engine';
import { downloadCSV } from '../../design/downloadCSV';
import { dataChanged } from '../../lib/dataEvents';
import { callMessage } from '../../lib/errors';
import { importActuals, importBalances, type BalanceImportResult, type Connection, type ImportKind, type ImportResult } from './api';
import { dateTime, drCr, monthLabel, monthsSummary, plural } from './format';

export interface ImportWizardProps {
  entityId: string;
  currency: Currency;
  connection: Connection;
  fiscalYearStartMonth: number;
  /** Months already imported into this connection (they will be replaced); null while unknown. */
  importedMonths: ReadonlySet<Period> | null;
  /** Phase 2: months of balances already imported (replaced by a balances file); null while unknown. */
  importedBalanceMonths?: ReadonlySet<Period> | null;
  /** Phase 2: codes of this connection's accounts mapped to Cash and bank; null while unknown. */
  cashCodes?: ReadonlySet<string> | null;
  mapPath: string;
  /** Called after any attempt that reached the server, so the page reloads its status. */
  onAttempted: () => void;
  /** Today, for the latest month allowed (tests pass a fixed date). */
  today?: Date;
}

interface Answers { ytd: boolean; incomePositive: boolean }
interface FileData { name: string; headers: string[]; rows: CsvRow[] }

type Step =
  | { name: 'choose'; error?: string }
  | { name: 'columns'; file: FileData; map: ColumnMap; answers: Answers; error?: string }
  | { name: 'preview'; file: FileData; map: ColumnMap; answers: Answers; prepared: Prepared }
  | { name: 'importing'; file: FileData; answers: Answers; prepared: Prepared }
  | { name: 'done'; file: FileData; answers: Answers; prepared: Prepared; result: ImportResult | BalanceImportResult }
  | { name: 'failed'; file: FileData; map: ColumnMap; answers: Answers; prepared: Prepared; message: string; certain: boolean };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHOWN_PROBLEMS = 100;

export const TEMPLATE_ROWS = [
  ['account_code', 'account_name', 'month', 'amount'],
  ['4000', 'Sales', '2025-01', '-12000.00'],
  ['5000', 'Rent', '2025-01', '1500.00'],
];

/** Phase 2: month-end (closing) balances, trial-balance sign: money in the bank positive, an overdraft negative. */
export const BALANCES_TEMPLATE_ROWS = [
  ['account_code', 'account_name', 'month', 'amount'],
  ['1210', 'Bank current account', '2025-01', '15000.00'],
  ['1220', 'Bank deposit account', '2025-01', '5000.00'],
  ['1100', 'Trade debtors', '2025-01', '4200.00'],
];

export const BALANCES_TEXT = 'Month-end (closing) balances, trial-balance sign: money in the bank is positive, an overdraft negative. Used as they are.';

export function answersText(a: Answers, kind: ImportKind = 'actuals'): string[] {
  if (kind === 'balances') return [BALANCES_TEXT];
  return [
    a.ytd ? 'Amounts are year-to-date balances (turned into monthly movements).' : 'Amounts are monthly movements.',
    a.incomePositive ? 'Income is positive in the file (every sign was flipped).' : 'Income is negative in the file (trial-balance style, used as it is).',
  ];
}

export function ImportWizard(props: ImportWizardProps) {
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const [kind, setKind] = useState<ImportKind>('actuals');
  const ids = useId();
  const balances = kind === 'balances';
  const currentMonth = monthOf(props.today ?? new Date());

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > IMPORT_LIMITS.maxBytes) {
      setStep({ name: 'choose', error: `${f.name} is ${(f.size / 1048576).toFixed(1)} MB; the most one import can take is 5 MB. Split it into smaller files (by month, for example).` });
      return;
    }
    let text: string;
    try { text = await f.text(); } catch (err) {
      setStep({ name: 'choose', error: `The file could not be read: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    if (text.includes('�')) {
      setStep({ name: 'choose', error: 'The file is not UTF-8 text. In Excel, use Save As and choose "CSV UTF-8 (Comma delimited)".' });
      return;
    }
    let rows: CsvRow[];
    try { rows = parseCsv(text); } catch (err) {
      setStep({ name: 'choose', error: err instanceof CsvSyntaxError ? `The file is not valid CSV. ${err.message}` : String(err) });
      return;
    }
    const head = rows[0];
    if (!head || head.cells.every(c => c.trim() === '')) {
      setStep({ name: 'choose', error: 'The file is empty. The first line must be the column headings.' });
      return;
    }
    const headers = head.cells.map(c => c.trim());
    const name = f.name.trim().slice(0, 200) || 'upload.csv';
    setStep({ name: 'columns', file: { name, headers, rows: rows.slice(1) }, map: guessColumns(headers), answers: { ytd: false, incomePositive: false } });
  }

  function check(file: FileData, map: ColumnMap, answers: Answers) {
    const problems = columnMapProblems(map, file.headers.length);
    if (problems.length) { setStep({ name: 'columns', file, map, answers, error: problems.join(' ') }); return; }
    const opts = balances ? { ytd: false, incomePositive: false, balances: true } : answers;
    const prepared = prepareImport(file.rows, map, { ...opts, fiscalYearStartMonth: props.fiscalYearStartMonth, currentMonth, currency: props.currency });
    setStep({ name: 'preview', file, map, answers, prepared });
  }

  async function runImport(file: FileData, map: ColumnMap, answers: Answers, prepared: Prepared) {
    if (prepared.problems.length || prepared.payload.length === 0) return;
    setStep({ name: 'importing', file, answers, prepared });
    try {
      const result = balances
        ? await importBalances(props.entityId, props.connection.id, prepared.payload, file.name)
        : await importActuals(props.entityId, props.connection.id, prepared.payload, file.name);
      setStep({ name: 'done', file, answers, prepared, result });
      dataChanged(props.entityId);
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      // A database error code means the transaction was undone. Without one (the network failed,
      // or the gateway refused) Klaro cannot know whether the import finished.
      const certain = typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code);
      setStep({ name: 'failed', file, map, answers, prepared, message: lineNumbers(callMessage(err, 'import'), prepared.lines), certain });
    } finally {
      props.onAttempted();
    }
  }

  const restart = <button type="button" className="btn btn-s btn-sm" onClick={() => setStep({ name: 'choose' })}>Choose another file</button>;

  if (step.name === 'choose') {
    return (
      <div>
        <fieldset className="f-group">
          <legend className="f-label">What does the file hold?</legend>
          <label className="radio"><input type="radio" name={`${ids}-kind`} checked={!balances} onChange={() => setKind('actuals')} /> P&amp;L movements (income and costs, month by month)</label>
          <label className="radio"><input type="radio" name={`${ids}-kind`} checked={balances} onChange={() => setKind('balances')} /> Month-end balances (bank, cash and other balance-sheet accounts)</label>
        </fieldset>
        {balances ? (
          <p className="f-hint" style={{ marginBottom: 10 }}>
            A CSV file with one row per account per month-end: account code, account name (optional), month (2025-01, or a date such
            as 31/01/2025, day first) and the closing balance. Debits positive, credits negative: money in the bank is positive, an
            overdraft negative. At most 20,000 rows and 5 MB. Importing a month replaces every balance already imported for that month.
          </p>
        ) : (
          <p className="f-hint" style={{ marginBottom: 10 }}>
            A CSV file with one row per account per month: account code, account name (optional), month (2025-01, or a date such
            as 31/01/2025, day first) and amount. Amounts like -1200.50, 1,200.50, {props.currency === 'GBP' ? '£' : '€'}1,200.50, or (1,200.50) for a
            negative; no other currency sign. Debits positive, credits negative, unless you say otherwise on the next step. At most
            20,000 rows and 5 MB. Importing a month replaces everything already imported for that month.
          </p>
        )}
        <div className="row-gap" style={{ marginBottom: 12 }}>
          <label className="btn btn-p" htmlFor={`${ids}-file`} style={{ display: 'inline-flex', alignItems: 'center' }}>Choose a CSV file</label>
          <input id={`${ids}-file`} className="sr-only" type="file" accept=".csv,text/csv" onChange={onFile} aria-label="CSV file to import" />
          {balances ? (
            <>
              <button type="button" className="btn btn-s btn-sm" onClick={() => downloadCSV('klaro-balances-template.csv', BALANCES_TEMPLATE_ROWS)}>Download the balances template</button>
              <a className="btn btn-s btn-sm link-btn" href="/samples/sample-balances.csv" download>Download the balances sample</a>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-s btn-sm" onClick={() => downloadCSV('klaro-actuals-template.csv', TEMPLATE_ROWS)}>Download the template</button>
              <a className="btn btn-s btn-sm link-btn" href="/samples/sample-actuals.csv" download>Download the sample file</a>
            </>
          )}
        </div>
        {step.error && <p className="msg msg-error" role="alert">{step.error}</p>}
      </div>
    );
  }

  if (step.name === 'columns') {
    const { file, map, answers } = step;
    const setMap = (f: keyof ColumnMap, v: string) => setStep({ ...step, map: { ...map, [f]: v === '' ? null : Number(v) }, error: undefined });
    const setAns = (a: Partial<Answers>) => setStep({ ...step, answers: { ...answers, ...a } });
    return (
      <div>
        <h3 className="step-title">1. Match the columns in {file.name}{balances && ' (month-end balances)'}</h3>
        <div className="grid-fields">
          {FIELDS.map(f => (
            <div className="f-group" key={f}>
              <label className="f-label" htmlFor={`${ids}-${f}`}>{FIELD_LABELS[f]}</label>
              <select id={`${ids}-${f}`} className="f-input" value={map[f] ?? ''} onChange={e => setMap(f, e.target.value)}>
                <option value="">{f === 'account_name' ? 'Not in the file' : 'Choose a column'}</option>
                {file.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
              </select>
            </div>
          ))}
        </div>
        {balances ? (
          <p className="f-hint" style={{ margin: '8px 0 12px' }}>{BALANCES_TEXT}</p>
        ) : (
          <>
            <h3 className="step-title">2. What do the numbers mean?</h3>
            <fieldset className="f-group">
              <legend className="f-label">Are the amounts monthly movements or year-to-date balances?</legend>
              <label className="radio"><input type="radio" name={`${ids}-ytd`} checked={!answers.ytd} onChange={() => setAns({ ytd: false })} /> Monthly movements (each month on its own)</label>
              <label className="radio"><input type="radio" name={`${ids}-ytd`} checked={answers.ytd} onChange={() => setAns({ ytd: true })} /> Year-to-date balances (Klaro works out each month, within financial years starting in {MONTH_NAMES[props.fiscalYearStartMonth - 1]})</label>
            </fieldset>
            <fieldset className="f-group">
              <legend className="f-label">Does income appear as a positive number in the file?</legend>
              <label className="radio"><input type="radio" name={`${ids}-sign`} checked={!answers.incomePositive} onChange={() => setAns({ incomePositive: false })} /> No: income is negative, costs positive (trial-balance style, as in the template)</label>
              <label className="radio"><input type="radio" name={`${ids}-sign`} checked={answers.incomePositive} onChange={() => setAns({ incomePositive: true })} /> Yes: income is positive (Klaro flips every sign before importing)</label>
            </fieldset>
          </>
        )}
        {step.error && <p className="msg msg-error" role="alert" style={{ marginBottom: 12 }}>{step.error}</p>}
        <div className="row-gap">
          <button type="button" className="btn btn-p" onClick={() => check(file, map, answers)}>Check the file</button>
          {restart}
        </div>
      </div>
    );
  }

  if (step.name === 'importing') {
    return <p className="loading" role="status">Importing {plural(step.prepared.payload.length, balances ? 'balance' : 'row')} from {step.file.name}… Keep this page open.</p>;
  }

  if (step.name === 'done') {
    const { result, answers, file } = step;
    return (
      <section aria-labelledby={`${ids}-done`}>
        <h3 className="step-title" id={`${ids}-done`}>Imported</h3>
        <p className="msg msg-ok" role="status" style={{ marginBottom: 12 }}>
          {file.name} is imported: {plural(result.rows_added, 'row')} added, {plural(result.rows_removed, 'earlier row')} removed.
        </p>
        <dl className="facts">
          <dt>Months replaced</dt><dd>{monthsSummary(result.months_replaced)}</dd>
          <dt>Rows removed</dt><dd>{result.rows_removed.toLocaleString('en-IE')}</dd>
          <dt>Rows added</dt><dd>{result.rows_added.toLocaleString('en-IE')}</dd>
          {'balances_through' in result ? (
            <>
              <dt>Balances through</dt><dd>{monthLabel(result.balances_through)}</dd>
              <dt>Imported at</dt><dd>{dateTime(result.imported_at)}</dd>
            </>
          ) : (
            <>
              <dt>Actuals through</dt><dd>{monthLabel(result.actuals_through)}</dd>
              <dt>Last synced</dt><dd>{dateTime(result.last_synced_at)}</dd>
            </>
          )}
          <dt>{balances ? 'The amounts' : 'Your answers'}</dt><dd>{answersText(answers, kind).map(t => <div key={t}>{t}</div>)}</dd>
        </dl>
        <div className="row-gap" style={{ marginTop: 12 }}>
          <Link className="btn btn-p link-btn" to={props.mapPath}>{balances ? 'Map the balance accounts' : 'Map the accounts'}</Link>
          {restart}
        </div>
      </section>
    );
  }

  // preview or failed
  const { file, map, answers, prepared } = step;
  const p = prepared;
  const known = balances ? props.importedBalanceMonths ?? null : props.importedMonths;
  const replacing = known ? p.months.filter(m => known.has(m)) : [];
  const cashMissing = balances && props.cashCodes ? missingCashRows(p.payload, props.cashCodes) : [];
  const canImport = p.problems.length === 0 && p.payload.length > 0;
  return (
    <section aria-labelledby={`${ids}-preview`}>
      <h3 className="step-title" id={`${ids}-preview`}>{balances ? '2' : '3'}. Check before importing {file.name}{balances && ' (month-end balances)'}</h3>
      {step.name === 'failed' && (
        <div className="msg msg-error" role="alert" style={{ marginBottom: 12 }}>
          <strong>{step.certain ? 'Nothing was imported.' : 'Klaro could not confirm whether the import finished.'}</strong>{' '}
          {step.message}
          {!step.certain && ' Check "Recent imports" below before trying again.'}
        </div>
      )}
      <dl className="facts">
        <dt>Rows read</dt><dd>{p.dataRows.toLocaleString('en-IE')}{p.blankRows > 0 && ` (${plural(p.blankRows, 'blank line')} skipped)`}</dd>
        <dt>Rows with problems</dt><dd>{new Set(p.problems.map(x => x.line)).size.toLocaleString('en-IE')}</dd>
        <dt>Rows to import</dt><dd>{p.payload.length.toLocaleString('en-IE')}</dd>
        <dt>Accounts</dt><dd>{p.accounts.toLocaleString('en-IE')}</dd>
        <dt>Months</dt><dd>{monthsSummary(p.months)}</dd>
        <dt>Debits / credits</dt><dd>{drCr(p.debits, props.currency)} / {drCr(p.credits, props.currency)}</dd>
        <dt>{balances ? 'The amounts' : 'Your answers'}</dt><dd>{answersText(answers, kind).map(t => <div key={t}>{t}</div>)}</dd>
      </dl>
      {replacing.length > 0 && (
        <p className="msg msg-warn" style={{ marginTop: 12 }}>
          Already imported, and will be replaced completely: {monthsSummary(replacing)}. Accounts missing from this file for those months will be removed.
        </p>
      )}
      {balances && p.problems.length === 0 && !props.cashCodes && (
        <p className="msg msg-warn" style={{ marginTop: 12 }}>Klaro could not check which accounts are mapped to Cash and bank.</p>
      )}
      {cashMissing.length > 0 && p.problems.length === 0 && (
        <div className="msg msg-warn" style={{ marginTop: 12 }} data-testid="cash-missing">
          {cashMissing.slice(0, 10).map(m => <div key={`${m.code}|${m.month}`}>{missingCashText(m)}</div>)}
          {cashMissing.length > 10 && <div>And {(cashMissing.length - 10).toLocaleString('en-IE')} more like this.</div>}
          <div style={{ marginTop: 4 }}>You can still import; check the file if a bank account is missing by mistake.</div>
        </div>
      )}
      {!known && (
        <p className="msg msg-warn" style={{ marginTop: 12 }}>
          Klaro could not check which of these months were imported before. Any that were will be replaced completely.
        </p>
      )}
      {p.warnings.map(w => <p className="msg msg-warn" key={w} style={{ marginTop: 12 }}>{w}</p>)}
      {p.problems.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p className="msg msg-error" role="alert">
            {plural(p.problems.length, 'problem')} found. Nothing can be imported until the file is fixed. Fix them in the file and choose it again.
          </p>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="gl-table" aria-label="Problems in the file">
              <thead><tr><th scope="col">Line</th><th scope="col">Problem</th></tr></thead>
              <tbody>
                {p.problems.slice(0, SHOWN_PROBLEMS).map((x, i) => (
                  <tr key={i}><td className="mono">{x.line === 0 ? 'File' : x.line}</td><td>{capitalise(x.message)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.problems.length > SHOWN_PROBLEMS && <p className="f-hint" style={{ marginTop: 6 }}>Showing the first {SHOWN_PROBLEMS} of {p.problems.length.toLocaleString('en-IE')}.</p>}
          <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }}
            onClick={() => downloadCSV(`problems-${file.name.replace(/\.csv$/i, '')}.csv`, [['line', 'problem'], ...p.problems.map(x => [x.line === 0 ? 'file' : x.line, capitalise(x.message)])])}>
            Download all problems (CSV)
          </button>
        </div>
      )}
      {canImport && (
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="gl-table" aria-label="First rows to import">
            <caption className="f-hint" style={{ textAlign: 'left', padding: '0 0 6px' }}>First {Math.min(10, p.payload.length)} rows as they will be imported (debits positive{balances ? '; closing balances' : ''})</caption>
            <thead><tr><th scope="col">Account</th><th scope="col">Name</th><th scope="col">Month</th><th scope="col" className="r">Amount</th></tr></thead>
            <tbody>
              {p.payload.slice(0, 10).map((r, i) => (
                <tr key={i}><td className="mono">{r.account_code}</td><td>{r.account_name ?? ''}</td><td>{monthLabel(r.month)}</td><td className="r mono">{r.amount}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row-gap" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn-p" disabled={!canImport} onClick={() => runImport(file, map, answers, prepared)}>
          {canImport ? `Import ${plural(p.payload.length, balances ? 'balance' : 'row')}` : 'Import'}
        </button>
        <button type="button" className="btn btn-s btn-sm" onClick={() => setStep({ name: 'columns', file, map, answers })}>{balances ? 'Change columns' : 'Change columns or answers'}</button>
        {restart}
      </div>
    </section>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The server numbers rows from 1 in the order sent; the person needs the file's line. */
export function lineNumbers(message: string, lines: readonly number[]): string {
  return message.replace(/^Row (\d+): /, (whole, n: string) => {
    const line = lines[Number(n) - 1];
    return line ? `Line ${line}: ` : whole;
  });
}
