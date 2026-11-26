// Report (Phase 3, behind REPORT_LIVE): a one-page monthly board pack for the entity that reads well
// on screen and prints to PDF. It only reads, with the user's own row security, through the same
// calls as the other screens:
//   Headlines       loadKpis (the KPI strip's own loader and rules)
//   Budget/actual   fpa.variance -> toLines -> sumCells (exactly Compare's path and figures)
//   Trend           the same lines; fpa.cash_position -> cashKpis
//   Scenarios       fpa.scenarios / drivers / driver_values -> applyScenario / summarise (as the panel)
//   Data quality    account_map (unmapped, excluded) and cash_position (balances)
// Each section loads on its own: one that fails shows its own error and the rest still render.
// Opening the page writes nothing. Viewers can see it.
import { useUser } from '@clerk/clerk-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { REPORT_LIVE } from '../../app/shell/kpiSwitch';
import { EmptyState } from '../../app/shell/parts';
import { entityPath } from '../../app/shell/tasks';
import { downloadCSV } from '../../design/downloadCSV';
import {
  addMonths, applyScenario, cashKpis, DRIVER_DEFS, DRIVER_KEYS, fiscalYearStart, formatMoney, formatPct, INDICATIVE_LABEL, linearScale, monthOf,
  NO_CHANGE, parsePercent, qualityNotes, REPORT_FOOTNOTE, sumCells, summarise as summariseScenario, toCents, toLines, yearToMonth,
  type CashKpis, type CashRow, type Cell, type Drivers, type Line, type Period,
} from '../../engine';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { compareCsvRows } from '../compare/ComparePage';
import { accountMap, cashPosition, listConnections } from '../connect/api';
import { dateTime, drCr, monthLabel, plural } from '../connect/format';
import { summarise, toAccounts } from '../connect/mapping';
import { useCurrentEntity } from '../entities/context';
import { loadKpis } from '../kpi/LiveKpiStrip';
import { budgetLines, getPlan, listBudgets, variance, type BudgetLine } from '../plan/api';
import { latestActualsMonth } from '../plan/latest';
import { stored } from '../plan/ScenariosPanel';
import { listDrivers, listScenarios, listValues } from '../plan/scenariosApi';
import './report.css';

const BUDGET_LINES = ['revenue', 'cost_of_sales', 'payroll', 'marketing', 'premises', 'other_operating', 'interest', 'tax'];

export function ReportPage() {
  if (!REPORT_LIVE) return <ReportPlaceholder />;
  return <ReportForUser />;
}

function ReportPlaceholder() {
  const { entity } = useCurrentEntity();
  return (
    <EmptyState title="No reports yet">
      <p>Report will put together a board pack for a month: the figures, the variances and written commentary.</p>
      <p>It needs a plan and actuals to report on. Start with <Link to={entityPath(entity.id, 'connect')}>Connect</Link>.</p>
    </EmptyState>
  );
}

function ReportForUser() {
  const { user } = useUser();
  const who = user?.fullName?.trim() || user?.primaryEmailAddress?.emailAddress || 'you';
  return <MonthlyReport generatedBy={who} />;
}

/** "Favourable" or "Unfavourable" in words (with a symbol); nothing when there is no variance. */
function FavWord({ value }: { value: boolean | null }) {
  if (value === null) return null;
  return value ? <span className="fav fav-good">▲ Favourable</span> : <span className="fav fav-bad">▼ Unfavourable</span>;
}

function Section({ title, children, id }: { title: string; children: ReactNode; id: string }) {
  return (
    <section className="card report-section" aria-labelledby={id}>
      <div className="card-header"><h2 className="card-title" id={id}>{title}</h2></div>
      <div className="card-body">{children}</div>
    </section>
  );
}

function Failed({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert">
      <p className="msg msg-error">{message}</p>
      <button type="button" className="btn btn-s btn-sm no-print" style={{ marginTop: 8 }} onClick={retry}>Try again</button>
    </div>
  );
}

export interface MonthlyReportProps { generatedBy: string; today?: Date; now?: Date }

export function MonthlyReport({ generatedBy, today, now }: MonthlyReportProps) {
  const { entity } = useCurrentEntity();
  const ids = useId();
  const currentMonth = monthOf(today ?? new Date());
  const generatedAt = useMemo(() => (now ?? new Date()).toISOString(), [now]);
  const money = (c: bigint | null) => (c === null ? '—' : formatMoney(c, entity.currency));

  const base = useLoad(async () => {
    const plan = await getPlan(entity.id);
    const [budgets, connections, accounts] = await Promise.all([listBudgets(plan.id), listConnections(entity.id), accountMap(entity.id)]);
    const lastSynced = connections.reduce<string | null>((m, c) => (c.last_synced_at && (!m || c.last_synced_at > m) ? c.last_synced_at : m), null);
    const acc = toAccounts(accounts);
    const unmapped = acc.filter(a => a.months > 0 && a.plan_line === null);
    return {
      plan, budgets, latest: latestActualsMonth(connections), lastSynced, excluded: summarise(acc),
      unmappedPnl: { count: unmapped.length, cents: unmapped.reduce((t, a) => t + a.cents, 0n) },
    };
  }, [entity.id], err => callMessage(err, 'compare'));
  const ctx = base.status === 'ok' ? base.data : null;

  const [monthChoice, setMonthChoice] = useState<Period | null>(null);
  const [versionChoice, setVersionChoice] = useState<string | null | undefined>(undefined);
  const month = monthChoice ?? ctx?.latest ?? currentMonth;
  const fyStart = fiscalYearStart(month, ctx?.plan.fiscal_year_start ?? 1);
  const yearMonths = Array.from({ length: 12 }, (_, k) => addMonths(fyStart, k));
  const budgetIds = (ctx?.budgets ?? []).map(b => b.id).join(',');

  // Which months each budget covers (its base-scenario lines), for the default budget and Scenarios.
  const coverage = useLoad(async () => {
    if (!ctx) return null;
    const all = await Promise.all(ctx.budgets.map(async b => [b.id, await budgetLines(b.id)] as const));
    return new Map<string, BudgetLine[]>(all);
  }, [entity.id, budgetIds, ctx === null], err => callMessage(err, 'budget'));
  const linesByBudget = coverage.status === 'ok' ? coverage.data : null;
  const defaultVersion = useMemo(() => {
    const budgets = ctx?.budgets ?? [];
    if (!linesByBudget) return budgets[budgets.length - 1]?.id ?? null; // as Compare, until coverage is known
    for (let i = budgets.length - 1; i >= 0; i--) {
      const b = budgets[i];
      if (b && linesByBudget.get(b.id)?.some(l => l.period === month)) return b.id;
    }
    return null;
  }, [ctx, linesByBudget, month]);
  const version = versionChoice === undefined ? defaultVersion : versionChoice;
  const versionName = ctx?.budgets.find(b => b.id === version)?.name ?? null;

  const figures = useLoad(
    async () => (ctx ? toLines(await variance(entity.id, version, fyStart, addMonths(fyStart, 11))) : null),
    [entity.id, ctx === null, version, fyStart], err => callMessage(err, 'compare'));
  const kpis = useLoad(() => loadKpis(entity.id, currentMonth, entity.currency), [entity.id, currentMonth], err => callMessage(err, 'kpi'));
  const cash = useLoad(async () => {
    const rows = await cashPosition(entity.id);
    return { rows, k: cashKpis(rows, { currentMonth, actualsThrough: ctx?.latest ?? null, currency: entity.currency }) };
  }, [entity.id, currentMonth, ctx?.latest ?? null], err => callMessage(err, 'kpi'));
  const scen = useLoad(async () => {
    if (!version || !ctx) return null;
    const scenarios = await listScenarios(version);
    if (!scenarios.some(s => !s.is_base)) return { scenarios, drivers: [], values: [] };
    const [drivers, values] = await Promise.all([listDrivers(ctx.plan.id), listValues(scenarios.map(s => s.id))]);
    return { scenarios, drivers, values };
  }, [version, ctx?.plan.id ?? null], err => callMessage(err, 'budget'));

  if (base.status === 'loading') return <p className="loading" role="status">Loading the report…</p>;
  if (base.status === 'error' || !ctx) return <Failed message={`The report could not be loaded. ${base.status === 'error' ? base.message : ''}`} retry={base.reload} />;

  const latest = ctx.latest;
  const monthOptions = latest ? Array.from({ length: 24 }, (_, k) => addMonths(latest, -k)) : [];
  const cashData = cash.status === 'ok' ? cash.data : null;
  const balancesThrough = cashData ? (cashData.rows[0]?.latestMonth ?? null) : undefined;
  const sources = [
    latest ? `Actuals through ${monthLabel(latest)}, last synced ${ctx.lastSynced ? dateTime(ctx.lastSynced) : 'never'}.` : 'No actuals imported yet.',
    balancesThrough === undefined ? (cash.status === 'error' ? 'The balances could not be checked.' : 'Checking the balances…')
      : balancesThrough ? `Balances through ${monthLabel(balancesThrough)}.` : 'No month-end balances imported yet.',
  ].join(' ');

  return (
    <div className="report">
      <header className="report-head">
        <div>
          <div className="report-entity">{entity.name}</div>
          <h1 className="report-title">Monthly report: {monthLabel(month)}</h1>
          <p className="f-hint" data-testid="report-generated">Generated {dateTime(generatedAt)} by {generatedBy}.</p>
          <p className="f-hint" data-testid="report-sources">{sources}</p>
        </div>
        <div className="row-gap no-print">
          <button type="button" className="btn btn-p" onClick={() => window.print()}>Print / save as PDF</button>
          {figures.status === 'ok' && figures.data && (
            <button type="button" className="btn btn-s btn-sm" onClick={() => downloadCSV(
              `report-${month.slice(0, 7)}-${(versionName ?? 'no-budget').replace(/[^A-Za-z0-9]+/g, '-')}.csv`,
              compareCsvRows(figures.data ?? [], yearMonths, month, m => m === latest && m === currentMonth))}>
              Download CSV (budget against actual)
            </button>
          )}
        </div>
      </header>

      <div className="card no-print report-pickers" style={{ marginBottom: 12 }}>
        <div className="card-body grid-fields">
          <div className="f-group">
            <label className="f-label" htmlFor={`${ids}-m`}>Month</label>
            <select id={`${ids}-m`} className="f-input" value={month} onChange={e => { setMonthChoice(e.target.value); setVersionChoice(undefined); }} disabled={!latest}>
              {monthOptions.length === 0 && <option value={month}>{monthLabel(month)}</option>}
              {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}{m === latest && m === currentMonth ? ' (may be incomplete)' : ''}</option>)}
            </select>
          </div>
          <div className="f-group">
            <label className="f-label" htmlFor={`${ids}-b`}>Budget</label>
            <select id={`${ids}-b`} className="f-input" value={version ?? ''} onChange={e => setVersionChoice(e.target.value || null)}>
              <option value="">No budget</option>
              {ctx.budgets.map(b => <option key={b.id} value={b.id}>{b.name}{b.locked_at ? ' (locked)' : ''}</option>)}
            </select>
          </div>
        </div>
      </div>

      {!latest && <p className="msg msg-warn" style={{ marginBottom: 12 }}>No actuals imported yet: most of this report shows "—". Import them on <Link to={entityPath(entity.id, 'connect')}>Connect</Link>.</p>}

      <Section title="1. Headlines" id={`${ids}-s1`}>
        {kpis.status === 'loading' && <p className="loading" role="status">Loading the headlines…</p>}
        {kpis.status === 'error' && <Failed message={`The headlines could not be loaded. ${kpis.message}`} retry={kpis.reload} />}
        {kpis.status === 'ok' && (
          <>
            <div className="kpi-grid report-kpis" data-testid="report-headlines">
              {kpis.data.tiles.map(t => {
                const shown = t.cents !== null ? formatMoney(t.cents, entity.currency) : t.text ?? null;
                return (
                  <div className="kpi-card" key={t.label}>
                    <div className="kpi-label">{t.label}</div>
                    <div className={`kpi-value${shown === null ? '' : ' kpi-live'}`} aria-label={shown === null ? 'No figure' : undefined}>{shown ?? '—'}</div>
                    {t.notes.map(n => <div className="kpi-sub" key={n}>{n}</div>)}
                  </div>
                );
              })}
            </div>
            {kpis.data.stripNote && <p className="msg msg-warn" style={{ marginTop: 8 }}>{kpis.data.stripNote}</p>}
            {latest && month !== latest && <p className="f-hint" style={{ marginTop: 6 }}>Headlines are always for the latest month, as on the key figures strip.</p>}
          </>
        )}
      </Section>

      <Section title={`2. Budget against actual: ${monthLabel(month)} and year to date${versionName ? ` (${versionName})` : ' (no budget)'}`} id={`${ids}-s2`}>
        {figures.status === 'loading' && <p className="loading" role="status">Loading the figures…</p>}
        {figures.status === 'error' && <Failed message={figures.message} retry={figures.reload} />}
        {figures.status === 'ok' && figures.data && (
          <BudgetActual lines={figures.data} month={month} yearStart={fyStart} money={money} hasVersion={version !== null}
            incomplete={month === latest && month === currentMonth} />
        )}
      </Section>

      <Section title="3. Trend" id={`${ids}-s3`}>
        <div className="report-charts">
          <div>
            <h3 className="step-title">Revenue and net profit, {monthLabel(fyStart)} to {monthLabel(month)}</h3>
            {figures.status === 'loading' && <p className="loading" role="status">Loading…</p>}
            {figures.status === 'error' && <Failed message={figures.message} retry={figures.reload} />}
            {figures.status === 'ok' && figures.data && <RevenueProfitChart lines={figures.data} months={yearToMonth(fyStart, month)} money={money} />}
          </div>
          <div>
            <h3 className="step-title">Month-end cash</h3>
            {cash.status === 'loading' && <p className="loading" role="status">Loading…</p>}
            {cash.status === 'error' && <Failed message={`The cash figures could not be loaded. ${cash.message}`} retry={cash.reload} />}
            {cashData && <CashChart rows={cashData.rows} k={cashData.k} money={money} />}
          </div>
        </div>
      </Section>

      <Section title={`4. Scenarios${versionName ? ` (${versionName})` : ''}`} id={`${ids}-s4`}>
        {!version ? <p className="f-hint">No budget chosen, so there are no scenarios to show.</p>
          : scen.status === 'loading' || coverage.status === 'loading' ? <p className="loading" role="status">Loading the scenarios…</p>
          : scen.status === 'error' ? <Failed message={`The scenarios could not be loaded. ${scen.message}`} retry={scen.reload} />
          : coverage.status === 'error' ? <Failed message={`The budget could not be loaded. ${coverage.message}`} retry={coverage.reload} />
          : scen.data && linesByBudget && (
            <ScenarioTable data={scen.data} lines={linesByBudget.get(version) ?? []} months={yearMonths} money={money}
              cash={cashData ? cashData.k.cash.cents : null} cashError={cash.status === 'error'} />
          )}
      </Section>

      <Section title="5. Data quality and notes" id={`${ids}-s5`}>
        <DataQuality month={month} latest={latest} currentMonth={currentMonth} unmappedPnl={ctx.unmappedPnl}
          cash={cash.status === 'loading' ? 'loading' : cashData} currency={entity.currency}
          excluded={<><strong>Not in the P&amp;L (excluded):</strong> {plural(ctx.excluded.excludedCount, 'account')}, net total {drCr(ctx.excluded.excludedCents, entity.currency)} across all imported months.</>} />
      </Section>
    </div>
  );
}

function BudgetActual({ lines, month, yearStart, money, hasVersion, incomplete }: {
  lines: Line[]; month: Period; yearStart: Period; money: (c: bigint | null) => string; hasVersion: boolean; incomplete: boolean;
}) {
  // Exactly Compare's year to date: sumCells over the year's months up to the month.
  const ytdMonths = yearToMonth(yearStart, month);
  const ytd = (l: Line): Cell => sumCells(l.kind, ytdMonths.map(m => l.months.get(m)));
  const noBudget = lines.every(l => [...l.months.values()].every(c => c.budget === null));
  const cols = (c: Cell | undefined) => (
    <>
      <td className="r mono">{money(c?.budget ?? null)}</td>
      <td className="r mono">{money(c?.actual ?? null)}</td>
      <td className="r mono">{money(c?.variance ?? null)}</td>
      <td className="r mono">{formatPct(c?.pct ?? null)}</td>
      <td><FavWord value={c?.favourable ?? null} /></td>
    </>
  );
  const heads = <><th scope="col" className="r">Budget</th><th scope="col" className="r">Actual</th><th scope="col" className="r">Variance</th><th scope="col" className="r">Var %</th><th scope="col">Favourable?</th></>;
  return (
    <>
      {noBudget && <p className="msg msg-warn" style={{ marginBottom: 8 }}>{hasVersion ? 'This budget has no lines in this year' : 'No budget chosen'}: the Budget figures show "—".</p>}
      {incomplete && <p className="msg msg-warn" style={{ marginBottom: 8 }}>{monthLabel(month)} is this month: its actuals may be incomplete.</p>}
      <div className="table-wrap">
        <table className="gl-table report-table" aria-label="Budget against actual, month and year to date" data-testid="report-bva">
          <thead>
            <tr><th scope="col" rowSpan={2}>Line</th><th scope="colgroup" colSpan={5} className="grp">{monthLabel(month)}</th><th scope="colgroup" colSpan={5} className="grp">Year to date ({monthLabel(yearStart)} to {monthLabel(month)})</th></tr>
            <tr>{heads}{heads}</tr>
          </thead>
          <tbody>
            {lines.map(l => (
              <tr key={l.key} className={l.kind === 'calculated' ? 'row-total' : undefined} data-line={l.key}>
                <th scope="row">{l.label}</th>
                {cols(l.months.get(month))}
                {cols(ytd(l))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="f-hint" style={{ marginTop: 6 }}>The same figures as Compare. Revenue, costs and profit are positive numbers; a cost over budget is unfavourable. A year-to-date figure shows "—" if any month in it has no actuals (or no budget).</p>
    </>
  );
}

const W = 600, H = 230, L = 78, R = 590, T = 14, B = 186;

/** Revenue and Net profit by month (actual: solid with markers; budget: dashed), with a table for screen readers. */
function RevenueProfitChart({ lines, months, money }: { lines: Line[]; months: Period[]; money: (c: bigint | null) => string }) {
  const line = (key: string) => lines.find(l => l.key === key);
  const series = [
    { key: 'revenue', label: 'Revenue', kind: 'actual' as const, marker: 'circle' },
    { key: 'net_profit', label: 'Net profit', kind: 'actual' as const, marker: 'square' },
    { key: 'revenue', label: 'Revenue budget', kind: 'budget' as const, marker: 'circle' },
    { key: 'net_profit', label: 'Net profit budget', kind: 'budget' as const, marker: 'square' },
  ].map(s => ({ ...s, values: months.map(m => line(s.key)?.months.get(m)?.[s.kind] ?? null) }))
    .filter(s => s.kind === 'actual' || s.values.some(v => v !== null));
  if (months.length === 0) return <p className="f-hint">No months to show.</p>;
  if (series.every(s => s.values.every(v => v === null))) return <p className="f-hint">No actuals in this year yet: "—".</p>;
  const scale = linearScale(series.flatMap(s => s.values), T, B);
  const x = (i: number) => (months.length === 1 ? (L + R) / 2 : L + (i * (R - L)) / (months.length - 1));
  const ticks = [scale.max, 0, scale.min].filter((v, i, a) => a.indexOf(v) === i);
  const tickLabel = (v: number) => `${v < 0 ? '-' : ''}€${Math.round(Math.abs(v)).toLocaleString('en-IE')}`;
  const desc = series.map(s => `${s.label}: ${months.map((m, i) => `${monthLabel(m)} ${money(s.values[i] ?? null)}`).join(', ')}`).join('. ');
  return (
    <figure className="report-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Revenue and net profit by month. ${desc}`} preserveAspectRatio="xMidYMid meet">
        {ticks.map(v => {
          const y = scale.y(BigInt(Math.round(v * 100)));
          return <g key={v}><line x1={L} x2={R} y1={y} y2={y} className={v === 0 ? 'axis-zero' : 'grid'} /><text x={L - 6} y={y + 4} textAnchor="end" className="tick">{tickLabel(v)}</text></g>;
        })}
        {months.map((m, i) => <text key={m} x={x(i)} y={B + 16} textAnchor="middle" className="tick">{monthLabel(m).slice(0, 3)}</text>)}
        {series.map(s => {
          const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${scale.y(v)}`));
          const segs: string[][] = [];
          let cur: string[] = [];
          for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
          if (cur.length) segs.push(cur);
          const cls = `series series-${s.key.replace('_', '-')} series-${s.kind}`;
          return (
            <g key={s.label} className={cls}>
              {segs.map((seg, i) => <polyline key={i} points={seg.join(' ')} fill="none" />)}
              {s.values.map((v, i) => (v === null ? null : s.marker === 'circle'
                ? <circle key={i} cx={x(i)} cy={scale.y(v)} r={3.5} />
                : <rect key={i} x={x(i) - 3.5} y={scale.y(v) - 3.5} width={7} height={7} />))}
            </g>
          );
        })}
      </svg>
      <figcaption className="report-legend">
        {series.map(s => (
          <span key={s.label} className={`legend-item series-${s.key.replace('_', '-')} series-${s.kind}`}>
            <svg width="26" height="10" aria-hidden="true"><line x1="1" x2="25" y1="5" y2="5" />{s.marker === 'circle' ? <circle cx="13" cy="5" r="3.5" /> : <rect x="9.5" y="1.5" width="7" height="7" />}</svg>
            {s.label}{s.kind === 'budget' ? ' (dashed)' : ''}
          </span>
        ))}
      </figcaption>
      <table className="sr-only"><caption>Revenue and net profit by month</caption>
        <thead><tr><th scope="col">Month</th>{series.map(s => <th scope="col" key={s.label}>{s.label}</th>)}</tr></thead>
        <tbody>{months.map((m, i) => <tr key={m}><th scope="row">{monthLabel(m)}</th>{series.map(s => <td key={s.label}>{money(s.values[i] ?? null)}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Month-end cash for the last five month-ends (bars, with the value written on each), and Runway beside it. */
function CashChart({ rows, k, money }: { rows: CashRow[]; k: CashKpis; money: (c: bigint | null) => string }) {
  if (k.cash.cents === null) {
    return (
      <div data-testid="report-cash">
        <div className="kpi-value" aria-label="No figure">—</div>
        {k.cash.notes.map(n => <p className="f-hint" key={n}>{n}</p>)}
      </div>
    );
  }
  const shown = [...rows].reverse();
  const scale = linearScale(shown.map(r => r.cash), T + 14, B);
  const step = (R - L) / shown.length;
  return (
    <div className="report-cash" data-testid="report-cash">
      <figure className="report-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" preserveAspectRatio="xMidYMid meet"
          aria-label={`Month-end cash: ${shown.map(r => `${monthLabel(r.month)} ${r.hasBalances ? money(r.cash) : 'no balances'}`).join(', ')}.`}>
          <line x1={L} x2={R} y1={scale.zero} y2={scale.zero} className="axis-zero" />
          {shown.map((r, i) => {
            const cx = L + step * i + step / 2;
            if (!r.hasBalances || r.cash === null) return <g key={r.month}><text x={cx} y={scale.zero - 6} textAnchor="middle" className="tick">no balances</text><text x={cx} y={B + 16} textAnchor="middle" className="tick">{monthLabel(r.month).slice(0, 3)}</text></g>;
            const y = scale.y(r.cash);
            const top = Math.min(y, scale.zero), h = Math.max(1, Math.abs(scale.zero - y));
            return (
              <g key={r.month}>
                <rect x={cx - step * 0.3} y={top} width={step * 0.6} height={h} className="bar" />
                <text x={cx} y={top - 4} textAnchor="middle" className="bar-label">{money(r.cash)}</text>
                <text x={cx} y={B + 16} textAnchor="middle" className="tick">{monthLabel(r.month).slice(0, 3)} {r.month.slice(2, 4)}</text>
              </g>
            );
          })}
        </svg>
      </figure>
      <div className="report-cash-side">
        <div className="kpi-label">Cash balance</div>
        <div className="kpi-value">{money(k.cash.cents)}</div>
        {k.cash.notes.map(n => <div className="kpi-sub" key={n}>{n}</div>)}
        <div className="kpi-label" style={{ marginTop: 10 }}>Runway (months)</div>
        <div className="kpi-value">{k.runway.text ?? '—'}</div>
        {k.runway.notes.map(n => <div className="kpi-sub" key={n}>{n}</div>)}
      </div>
    </div>
  );
}

function ScenarioTable({ data, lines, months, money, cash, cashError }: {
  data: { scenarios: { id: string; name: string; is_base: boolean }[]; drivers: { id: string; key: string }[]; values: { driver_id: string; scenario_id: string; value: number | string }[] };
  lines: BudgetLine[]; months: Period[]; money: (c: bigint | null) => string; cash: bigint | null; cashError: boolean;
}) {
  if (!data.scenarios.some(s => !s.is_base)) return <p className="f-hint" data-testid="report-no-scenarios">No scenarios saved for this budget.</p>;
  const baseLines = new Map<string, bigint[]>();
  for (const line of BUDGET_LINES) baseLines.set(line, months.map(m => {
    const l = lines.find(x => x.plan_line === line && x.period === m);
    return l && l.amount !== null ? toCents(l.amount) : 0n;
  }));
  const keyOf = new Map(data.drivers.map(d => [d.id, DRIVER_KEYS.find(k => DRIVER_DEFS[k].key === d.key)]));
  const driversFor = (scenarioId: string, isBase: boolean): Drivers | null => {
    if (isBase) return NO_CHANGE;
    const out = { ...NO_CHANGE };
    for (const v of data.values.filter(x => x.scenario_id === scenarioId)) {
      const k = keyOf.get(v.driver_id);
      if (!k) continue;
      const p = parsePercent(stored(v.value));
      if ('problem' in p) return null;
      out[k] = p.bp;
    }
    return out;
  };
  return (
    <>
      <div className="table-wrap">
        <table className="gl-table report-table" aria-label="Saved scenarios compared" data-testid="report-scenarios">
          <thead><tr><th scope="col">Scenario</th>{DRIVER_KEYS.map(k => <th scope="col" className="r" key={k}>{DRIVER_DEFS[k].label} %</th>)}<th scope="col" className="r">Revenue</th><th scope="col" className="r">Total costs</th><th scope="col" className="r">Net profit</th><th scope="col" className="r">Closing cash, month 12 (indicative)</th></tr></thead>
          <tbody>
            {data.scenarios.map(s => {
              const d = driversFor(s.id, s.is_base);
              const sum = d ? summariseScenario(applyScenario(baseLines, d), cash) : null;
              return (
                <tr key={s.id}>
                  <th scope="row">{s.name}{s.is_base && <span className="f-hint"> (the budget as it is)</span>}</th>
                  {DRIVER_KEYS.map(k => <td className="r mono" key={k}>{d ? (Number(d[k]) / 100).toString() : '?'}</td>)}
                  {sum ? <><td className="r mono">{money(sum.revenue)}</td><td className="r mono">{money(sum.costs)}</td><td className="r mono">{money(sum.netProfit)}</td><td className="r mono">{money(sum.closingCash)}</td></>
                    : <td colSpan={4}>A stored driver is not a valid percentage.</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="f-hint" style={{ marginTop: 6 }}>
        Year {monthLabel(months[0] ?? '2000-01-01')} to {monthLabel(months[11] ?? months[0] ?? '2000-01-01')}. Closing cash, month 12 = the latest cash balance + the year's net profit; {INDICATIVE_LABEL}.
        {cash === null && (cashError ? ' It shows "—" because the cash balance could not be loaded.' : ' It shows "—" because there is no cash balance.')}
      </p>
    </>
  );
}

function DataQuality({ month, latest, currentMonth, unmappedPnl, cash, currency, excluded }: {
  month: Period; latest: Period | null; currentMonth: Period; unmappedPnl: { count: number; cents: bigint };
  cash: 'loading' | { rows: CashRow[]; k: CashKpis } | null; currency: 'EUR' | 'GBP'; excluded: ReactNode;
}) {
  if (cash === 'loading') return <p className="loading" role="status">Checking…</p>;
  const notes = qualityNotes({
    month, actualsThrough: latest, currentMonth, unmappedPnl,
    unmappedBalance: cash === null ? null : (cash.rows[0]?.unmappedAccounts ?? 0),
    balancesThrough: cash === null ? undefined : (cash.rows[0]?.latestMonth ?? null),
  }, c => drCr(c, currency), monthLabel);
  return (
    <div data-testid="report-quality">
      {notes.length === 0 ? <p>None</p> : <ul className="report-notes">{notes.map(n => <li key={n}>{n}</li>)}</ul>}
      <p style={{ marginTop: 8 }}>{excluded}</p>
      <p className="f-hint" style={{ marginTop: 8 }}>{REPORT_FOOTNOTE}</p>
    </div>
  );
}
