// Compare (Phase 1, step 1E): budget against actuals from fpa.variance, for a month and the year to
// date, or every month of the financial year. Favourable and unfavourable are shown with a symbol and
// a word as well as colour. The excluded count and net total are always shown (ui-rules section 2); a
// month that may be incomplete is marked (section 5); a timeout says to try a shorter range (section 6).
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../../app/shell/parts';
import { entityPath } from '../../app/shell/tasks';
import { ExportDropdown } from '../../design/ExportDropdown';
import { downloadCSV, type CsvCell } from '../../design/downloadCSV';
import {
  addMonths, fiscalYearStart, formatMoney, formatPct, monthOf, sumCells, toLines, toAmount,
  type Cell, type Line, type Period,
} from '../../engine';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { accountMap, listConnections } from '../connect/api';
import { drCr, monthLabel, plural } from '../connect/format';
import { summarise, toAccounts } from '../connect/mapping';
import { useCurrentEntity } from '../entities/context';
import { getPlan, listBudgets, variance } from '../plan/api';
import { latestActualsMonth } from '../plan/latest';

type View = 'month' | 'all';
type Measure = 'actual' | 'budget' | 'variance' | 'pct';
const MEASURES: Record<Measure, string> = { actual: 'Actual', budget: 'Budget', variance: 'Variance', pct: 'Variance %' };

/** Favourable or not: a symbol and a word, never colour alone. */
export function Fav({ value }: { value: boolean | null }) {
  if (value === null) return null;
  return value
    ? <span className="fav fav-good" title="Favourable">▲ Fav<span className="sr-only">ourable</span></span>
    : <span className="fav fav-bad" title="Unfavourable">▼ Unfav<span className="sr-only">ourable</span></span>;
}

export function ComparePage({ today }: { today?: Date } = {}) {
  const { entity } = useCurrentEntity();
  const ids = useId();
  const currentMonth = monthOf(today ?? new Date());
  const base = useLoad(async () => {
    const plan = await getPlan(entity.id);
    const [budgets, connections, accounts] = await Promise.all([listBudgets(plan.id), listConnections(entity.id), accountMap(entity.id)]);
    return { plan, budgets, latest: latestActualsMonth(connections), excluded: summarise(toAccounts(accounts)) };
  }, [entity.id], err => callMessage(err, 'compare'));

  const [versionId, setVersionId] = useState<string | null | undefined>(undefined);
  const [year, setYear] = useState<Period | null>(null);
  const [month, setMonth] = useState<Period | null>(null);
  const [view, setView] = useState<View>('month');
  const [measure, setMeasure] = useState<Measure>('variance');

  const ctx = base.status === 'ok' ? base.data : null;
  const fyStart = ctx?.plan.fiscal_year_start ?? 1;
  const anchor = ctx?.latest ?? currentMonth;
  const defaultYear = fiscalYearStart(anchor, fyStart);
  const shownYear = year ?? defaultYear;
  const yearOptions = [-2, -1, 0, 1].map(k => addMonths(defaultYear, 12 * k));
  const months = Array.from({ length: 12 }, (_, k) => addMonths(shownYear, k));
  const shownMonth = month && months.includes(month) ? month
    : ctx?.latest && months.includes(ctx.latest) ? ctx.latest : (months[11] ?? shownYear);
  const budgets = ctx?.budgets ?? [];
  const shownVersion = versionId === undefined ? (budgets[budgets.length - 1]?.id ?? null) : versionId;
  const versionName = budgets.find(b => b.id === shownVersion)?.name ?? 'no budget';

  const figures = useLoad(
    async () => (ctx ? toLines(await variance(entity.id, shownVersion, shownYear, addMonths(shownYear, 11))) : null),
    [entity.id, ctx === null, shownVersion, shownYear],
    err => callMessage(err, 'compare'),
  );
  const lines: Line[] | null = figures.status === 'ok' ? figures.data : null;
  const ytdMonths = months.filter(m => m <= shownMonth);
  const maybeIncomplete = (m: Period) => ctx?.latest === m && m === currentMonth;

  const money = (c: bigint | null) => (c === null ? '—' : formatMoney(c, entity.currency));
  const ytd = (l: Line): Cell => sumCells(l.kind, ytdMonths.map(m => l.months.get(m)));
  const noActuals = useMemo(() => lines !== null && lines.every(l => [...l.months.values()].every(c => c.actual === null)), [lines]);
  const noBudget = useMemo(() => lines !== null && lines.every(l => [...l.months.values()].every(c => c.budget === null)), [lines]);

  function exportCsv() {
    if (!lines) return;
    const amt = (c: bigint | null) => (c === null ? '' : toAmount(c));
    const pct = (p: number | null) => (p === null ? '' : (Math.round(p * 10) / 10).toFixed(1));
    const fav = (f: boolean | null) => (f === null ? '' : f ? 'favourable' : 'unfavourable');
    const rows: CsvCell[][] = [['line', 'period', 'budget', 'actual', 'variance', 'variance_pct', 'favourable', 'note']];
    for (const l of lines) {
      for (const m of months) {
        const c = l.months.get(m);
        rows.push([l.label, m.slice(0, 7), amt(c?.budget ?? null), amt(c?.actual ?? null), amt(c?.variance ?? null), pct(c?.pct ?? null), fav(c?.favourable ?? null), maybeIncomplete(m) ? 'month may be incomplete' : '']);
      }
      const y = ytd(l);
      rows.push([l.label, `YTD to ${shownMonth.slice(0, 7)}`, amt(y.budget), amt(y.actual), amt(y.variance), pct(y.pct), fav(y.favourable), '']);
    }
    downloadCSV(`compare-${shownYear.slice(0, 7)}-${versionName.replace(/[^A-Za-z0-9]+/g, '-')}.csv`, rows);
  }

  if (base.status === 'loading') return <p className="loading" role="status">Loading…</p>;
  if (base.status === 'error' || !ctx) {
    return (
      <div role="alert">
        <p className="msg msg-error">Compare could not be loaded. {base.status === 'error' ? base.message : ''}</p>
        <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={base.reload}>Try again</button>
      </div>
    );
  }
  if (ctx.latest === null && budgets.length === 0) {
    return (
      <EmptyState title="Nothing to compare yet">
        <p>Compare puts the budget next to actuals, month by month and for the year to date.</p>
        <p>It needs actuals (from <Link to={entityPath(entity.id, 'connect')}>Connect</Link>) and a budget (from <Link to={entityPath(entity.id, 'plan')}>Plan</Link>).</p>
      </EmptyState>
    );
  }

  const ex = ctx.excluded;
  return (
    <>
      <section className="card" aria-label="What to compare" style={{ marginBottom: 12 }}>
        <div className="card-body">
          <div className="grid-fields">
            <div className="f-group">
              <label className="f-label" htmlFor={`${ids}-v`}>Budget</label>
              <select id={`${ids}-v`} className="f-input" value={shownVersion ?? ''} onChange={e => setVersionId(e.target.value || null)}>
                <option value="">No budget (actuals only)</option>
                {budgets.map(b => <option key={b.id} value={b.id}>{b.name}{b.locked_at ? ' (locked)' : ''}</option>)}
              </select>
            </div>
            <div className="f-group">
              <label className="f-label" htmlFor={`${ids}-y`}>Financial year</label>
              <select id={`${ids}-y`} className="f-input" value={shownYear} onChange={e => { setYear(e.target.value); setMonth(null); }}>
                {yearOptions.map(y => <option key={y} value={y}>{monthLabel(y)} to {monthLabel(addMonths(y, 11))}</option>)}
              </select>
            </div>
            <div className="f-group">
              <label className="f-label" htmlFor={`${ids}-m`}>Month</label>
              <select id={`${ids}-m`} className="f-input" value={shownMonth} onChange={e => setMonth(e.target.value)}>
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}{maybeIncomplete(m) ? ' (may be incomplete)' : ''}</option>)}
              </select>
            </div>
            <div className="f-group">
              <span className="f-label" id={`${ids}-vw`}>Show</span>
              <div role="group" aria-labelledby={`${ids}-vw`} className="seg">
                <button type="button" className={`seg-btn${view === 'month' ? ' active' : ''}`} aria-pressed={view === 'month'} onClick={() => setView('month')}>Month and YTD</button>
                <button type="button" className={`seg-btn${view === 'all' ? ' active' : ''}`} aria-pressed={view === 'all'} onClick={() => setView('all')}>Every month</button>
              </div>
            </div>
          </div>
          <p className="f-hint" data-testid="actuals-through">
            {ctx.latest ? `Actuals through ${monthLabel(ctx.latest)}.` : 'No actuals yet.'} Revenue, costs and profit are shown as positive numbers;
            a cost over budget is unfavourable.
          </p>
          <p style={{ marginTop: 8 }} data-testid="excluded-summary">
            <strong>Not in the P&amp;L (excluded):</strong> {plural(ex.excludedCount, 'account')}, net total {drCr(ex.excludedCents, entity.currency)} across all imported months.
            {ex.unmapped > 0 && <span className="f-hint"> {plural(ex.unmapped, 'account')} still unmapped: their amounts are on the Unmapped line, not in profit.</span>}
          </p>
        </div>
      </section>

      {figures.status === 'loading' && <p className="loading" role="status">Loading the figures…</p>}
      {figures.status === 'error' && (
        <div role="alert">
          <p className="msg msg-error">{figures.message}</p>
          <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={figures.reload}>Try again</button>
        </div>
      )}
      {lines && (
        <section className="card" aria-labelledby={`${ids}-t`}>
          <div className="card-header">
            <h2 className="card-title" id={`${ids}-t`}>
              {view === 'month' ? `${monthLabel(shownMonth)} and year to date` : `${monthLabel(shownYear)} to ${monthLabel(addMonths(shownYear, 11))}`}: {versionName}
            </h2>
            <ExportDropdown onCSV={exportCsv} />
          </div>
          <div className="card-body">
            {noActuals && <p className="msg msg-warn" style={{ marginBottom: 10 }}>No actuals in this year yet: the Actual figures show "—".</p>}
            {noBudget && <p className="msg msg-warn" style={{ marginBottom: 10 }}>{shownVersion ? 'This budget has no lines in this year' : 'No budget chosen'}: the Budget figures show "—".</p>}
            {view === 'month' && maybeIncomplete(shownMonth) && (
              <p className="msg msg-warn" data-testid="incomplete-note" style={{ marginBottom: 10 }}>{monthLabel(shownMonth)} is this month: its actuals may be incomplete.</p>
            )}
            {view === 'month' ? (
              <MonthTable lines={lines} month={shownMonth} ytd={ytd} money={money} ytdLabel={`${monthLabel(shownYear)} to ${monthLabel(shownMonth)}`} />
            ) : (
              <>
                <div className="row-gap" style={{ marginBottom: 8 }}>
                  <label className="f-label" htmlFor={`${ids}-me`}>Figure</label>
                  <select id={`${ids}-me`} className="f-input f-input-sm" style={{ width: 'auto' }} value={measure} onChange={e => setMeasure(e.target.value as Measure)}>
                    {(Object.keys(MEASURES) as Measure[]).map(k => <option key={k} value={k}>{MEASURES[k]}</option>)}
                  </select>
                </div>
                <div className="table-wrap">
                  <table className="gl-table compare-grid" aria-label={`${MEASURES[measure]} by month`}>
                    <thead>
                      <tr>
                        <th scope="col">Line</th>
                        {months.map(m => <th scope="col" key={m} className="r">{monthLabel(m)}{maybeIncomplete(m) && <span className="incomplete-mark" title="Month may be incomplete"> *<span className="sr-only"> month may be incomplete</span></span>}</th>)}
                        <th scope="col" className="r">YTD to {monthLabel(shownMonth)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map(l => {
                        const show = (c: Cell | undefined) => (!c ? '—' : measure === 'pct' ? formatPct(c.pct) : money(c[measure]));
                        const withFav = measure === 'variance' || measure === 'pct';
                        const y = ytd(l);
                        return (
                          <tr key={l.key} className={l.kind === 'calculated' ? 'row-total' : undefined}>
                            <th scope="row">{l.label}</th>
                            {months.map(m => {
                              const c = l.months.get(m);
                              return <td key={m} className="r mono">{show(c)}{withFav && c?.favourable != null && <> <Fav value={c.favourable} /></>}</td>;
                            })}
                            <td className="r mono">{show(y)}{withFav && y.favourable !== null && <> <Fav value={y.favourable} /></>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {months.some(maybeIncomplete) && <p className="f-hint" style={{ marginTop: 6 }}>* Month may be incomplete: it is this month.</p>}
              </>
            )}
            <p className="f-hint" style={{ marginTop: 8 }}>
              Unmapped: accounts not yet given a plan line; they are not in the profit lines. A year-to-date figure shows "—" if any month in it
              has no actuals (or no budget).
            </p>
          </div>
        </section>
      )}
    </>
  );
}

function MonthTable({ lines, month, ytd, money, ytdLabel }: {
  lines: Line[]; month: Period; ytd: (l: Line) => Cell; money: (c: bigint | null) => string; ytdLabel: string;
}) {
  const cols = (c: Cell | undefined, when: string) => (
    <>
      <td className="r mono stack-first" data-label={`Budget, ${when}`}>{money(c?.budget ?? null)}</td>
      <td className="r mono" data-label={`Actual, ${when}`}>{money(c?.actual ?? null)}</td>
      <td className="r mono" data-label={`Variance, ${when}`}>{money(c?.variance ?? null)}</td>
      <td className="r mono" data-label={`Var %, ${when}`}>{formatPct(c?.pct ?? null)}</td>
      <td className={c?.favourable == null ? 'stack-hide' : undefined}><Fav value={c?.favourable ?? null} /></td>
    </>
  );
  const heads = (
    <>
      <th scope="col" className="r">Budget</th>
      <th scope="col" className="r">Actual</th>
      <th scope="col" className="r">Variance</th>
      <th scope="col" className="r">Var %</th>
      <th scope="col"><span className="sr-only">Favourable or not</span></th>
    </>
  );
  return (
    <div className="table-wrap">
      <table className="gl-table compare-table stack-table" aria-label="Month and year to date">
        <thead>
          <tr>
            <th scope="col" rowSpan={2}>Line</th>
            <th scope="colgroup" colSpan={5} className="grp">{monthLabel(month)}</th>
            <th scope="colgroup" colSpan={5} className="grp">Year to date ({ytdLabel})</th>
          </tr>
          <tr>{heads}{heads}</tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.key} className={l.kind === 'calculated' ? 'row-total' : undefined}>
              <th scope="row">{l.label}</th>
              {cols(l.months.get(month), monthLabel(month))}
              {cols(ytd(l), 'year to date')}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
