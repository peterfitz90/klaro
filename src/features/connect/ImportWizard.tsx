// CSV import (Phase 1, step 1B): choose a file, match its columns, answer two questions about its
// numbers, check every row in the browser, then import in one transaction on the server.
// Fails closed: nothing is sent while any row has a problem, an error is never shown as success,
// and an import whose outcome is unknown says so (docs/ui-rules.md sections 3 and 6).
import { useId, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  columnMapProblems, CsvSyntaxError, FIELD_LABELS, FIELDS, guessColumns, IMPORT_LIMITS, monthOf, parseCsv, prepareImport,
  type ColumnMap, type CsvRow, type Currency, type Period, type Prepared,
} from '../../engine';
import { downloadCSV } from '../../design/downloadCSV';
import { callMessage } from '../../lib/errors';
import { importActuals, type Connection, type ImportResult } from './api';
import { dateTime, drCr, monthLabel, monthsSummary, plural } from './format';

export interface ImportWizardProps {
  entityId: string;
  currency: Currency;
  connection: Connection;
  fiscalYearStartMonth: number;
  /** Months already imported into this connection (they will be replaced); null while unknown. */
  importedMonths: ReadonlySet<Period> | null;
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
  | { name: 'done'; file: FileData; answers: Answers; prepared: Prepared; result: ImportResult }
  | { name: 'failed'; file: FileData; map: ColumnMap; answers: Answers; prepared: Prepared; message: string; certain: boolean };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHOWN_PROBLEMS = 100;

export const TEMPLATE_ROWS = [
  ['account_code', 'account_name', 'month', 'amount'],
  ['4000', 'Sales', '2025-01', '-12000.00'],
  ['5000', 'Rent', '2025-01', '1500.00'],
];

export function answersText(a: Answers): string[] {
  return [
    a.ytd ? 'Amounts are year-to-date balances (turned into monthly movements).' : 'Amounts are monthly movements.',
    a.incomePositive ? 'Income is positive in the file (every sign was flipped).' : 'Income is negative in the file (trial-balance style, used as it is).',
  ];
}

export function ImportWizard(props: ImportWizardProps) {
  const [step, setStep] = useState<Step>({ name: 'choose' });
  const ids = useId();
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
    const prepared = prepareImport(file.rows, map, { ...answers, fiscalYearStartMonth: props.fiscalYearStartMonth, currentMonth, currency: props.currency });
    setStep({ name: 'preview', file, map, answers, prepared });
  }

  async function runImport(file: FileData, map: ColumnMap, answers: Answers, prepared: Prepared) {
    if (prepared.problems.length || prepared.payload.length === 0) return;
    setStep({ name: 'importing', file, answers, prepared });
    try {
      const result = await importActuals(props.entityId, props.connection.id, prepared.payload, file.name);
      setStep({ name: 'done', file, answers, prepared, result });
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
        <p className="f-hint" style={{ marginBottom: 10 }}>
          A CSV file with one row per account per month: account code, account name (optional), month (2025-01, or a date such
          as 31/01/2025, day first) and amount. Amounts like -1200.50, 1,200.50, {props.currency === 'GBP' ? '£' : '€'}1,200.50, or (1,200.50) for a
          negative; no other currency sign. Debits positive, credits negative, unless you say otherwise on the next step. At most
          20,000 rows and 5 MB. Importing a month replaces everything already imported for that month.
        </p>
        <div className="row-gap" style={{ marginBottom: 12 }}>
          <label className="btn btn-p" htmlFor={`${ids}-file`} style={{ display: 'inline-flex', alignItems: 'center' }}>Choose a CSV file</label>
          <input id={`${ids}-file`} className="sr-only" type="file" accept=".csv,text/csv" onChange={onFile} aria-label="CSV file to import" />
          <button type="button" className="btn btn-s btn-sm" onClick={() => downloadCSV('klaro-actuals-template.csv', TEMPLATE_ROWS)}>Download the template</button>
          <a className="btn btn-s btn-sm link-btn" href="/samples/sample-actuals.csv" download>Download the sample file</a>
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
        <h3 className="step-title">1. Match the columns in {file.name}</h3>
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
        {step.error && <p className="msg msg-error" role="alert" style={{ marginBottom: 12 }}>{step.error}</p>}
        <div className="row-gap">
          <button type="button" className="btn btn-p" onClick={() => check(file, map, answers)}>Check the file</button>
          {restart}
        </div>
      </div>
    );
  }

  if (step.name === 'importing') {
    return <p className="loading" role="status">Importing {plural(step.prepared.payload.length, 'row')} from {step.file.name}… Keep this page open.</p>;
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
          <dt>Actuals through</dt><dd>{monthLabel(result.actuals_through)}</dd>
          <dt>Last synced</dt><dd>{dateTime(result.last_synced_at)}</dd>
          <dt>Your answers</dt><dd>{answersText(answers).map(t => <div key={t}>{t}</div>)}</dd>
        </dl>
        <div className="row-gap" style={{ marginTop: 12 }}>
          <Link className="btn btn-p link-btn" to={props.mapPath}>Map the accounts</Link>
          {restart}
        </div>
      </section>
    );
  }

  // preview or failed
  const { file, map, answers, prepared } = step;
  const p = prepared;
  const known = props.importedMonths;
  const replacing = known ? p.months.filter(m => known.has(m)) : [];
  const canImport = p.problems.length === 0 && p.payload.length > 0;
  return (
    <section aria-labelledby={`${ids}-preview`}>
      <h3 className="step-title" id={`${ids}-preview`}>3. Check before importing {file.name}</h3>
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
        <dt>Your answers</dt><dd>{answersText(answers).map(t => <div key={t}>{t}</div>)}</dd>
      </dl>
      {replacing.length > 0 && (
        <p className="msg msg-warn" style={{ marginTop: 12 }}>
          Already imported, and will be replaced completely: {monthsSummary(replacing)}. Accounts missing from this file for those months will be removed.
        </p>
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
            <caption className="f-hint" style={{ textAlign: 'left', padding: '0 0 6px' }}>First {Math.min(10, p.payload.length)} rows as they will be imported (debits positive)</caption>
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
          {canImport ? `Import ${plural(p.payload.length, 'row')}` : 'Import'}
        </button>
        <button type="button" className="btn btn-s btn-sm" onClick={() => setStep({ name: 'columns', file, map, answers })}>Change columns or answers</button>
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
