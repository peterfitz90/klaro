// Cash (Phase 4, behind CASH_PAGE_LIVE): month-end cash, net cash burn and Runway (the KPI strip's own
// engine, src/engine/cash.ts), up to 12 months of history, a 12-month "Current trend" projection,
// the saved scenarios as projections, a what-if burn (browser only), data quality, print and CSV.
// It only reads, under the user's own row security; opening it writes nothing. Each section loads
// on its own, so one that fails shows its own error. Prints with the Report's stylesheet.
import { useUser } from '@clerk/clerk-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CASH_PAGE_LIVE } from '../../app/shell/kpiSwitch';
import { EmptyState } from '../../app/shell/parts';
import { entityPath } from '../../app/shell/tasks';
import { downloadCSV } from '../../design/downloadCSV';
import {
  addMonths, applyScenario, BURN_LABEL, CASH_FOOTNOTE, cashCsvRows, cashHistory, cashKpis, cashQualityNotes, DRIVER_DEFS, DRIVER_KEYS, formatMoney,
  linearScale, monthOf, NO_CHANGE, NOT_SET_UP, parseBurn, parsePercent, projectCash, runsOut, runsOutText, SCENARIO_CASH_LABEL, scenarioOrder,
  summarise as summariseScenario, toCents, type CashMonth, type Drivers, type Period, type ProjectedMonth,
} from '../../engine';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { cashPosition, listConnections } from '../connect/api';
import { dateTime, monthLabel } from '../connect/format';
import { useCurrentEntity } from '../entities/context';
import { budgetLines, getPlan, listBudgets, type BudgetLine } from '../plan/api';
import { latestActualsMonth } from '../plan/latest';
import { stored } from '../plan/ScenariosPanel';
import { listDrivers, listScenarios, listValues } from '../plan/scenariosApi';
import '../report/report.css';
import { cashHistoryData } from './api';

const BUDGET_LINES = ['revenue', 'cost_of_sales', 'payroll', 'marketing', 'premises', 'other_operating', 'interest', 'tax'];

export function CashPage() {
  if (!CASH_PAGE_LIVE) return <CashPlaceholder />;
  return <CashForUser />;
}

function CashPlaceholder() {
  const { entity } = useCurrentEntity();
  return (
    <EmptyState title="No cash forecast yet">
      <p>Cash will show the three-way forecast: profit, balance sheet and cash, with the runway and when VAT falls due.</p>
      <p>It is built from the plan, so start with <Link to={entityPath(entity.id, 'connect')}>Connect</Link> and then <Link to={entityPath(entity.id, 'plan')}>Plan</Link>.</p>
    </EmptyState>
  );
}

function CashForUser() {
  const { user } = useUser();
  return <CashView generatedBy={user?.fullName?.trim() || user?.primaryEmailAddress?.emailAddress || 'you'} />;
}

function Section({ title, id, children }: { title: string; id: string; children: ReactNode }) {
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

interface Line { name: string; points: ProjectedMonth[]; style: 'trend' | 'whatif' | 'scenario'; index: number }

export interface CashViewProps { generatedBy: string; today?: Date; now?: Date }

export function CashView({ generatedBy, today, now }: CashViewProps) {
  const { entity } = useCurrentEntity();
  const ids = useId();
  const currentMonth = monthOf(today ?? new Date());
  const generatedAt = useMemo(() => (now ?? new Date()).toISOString(), [now]);
  const money = (c: bigint | null) => (c === null ? '—' : formatMoney(c, entity.currency));

  // Cash now: the KPI strip's own inputs and rules.
  const position = useLoad(async () => {
    const [rows, connections] = await Promise.all([cashPosition(entity.id), listConnections(entity.id)]);
    const actualsThrough = latestActualsMonth(connections);
    return { rows, actualsThrough, k: cashKpis(rows, { currentMonth, actualsThrough, currency: entity.currency }) };
  }, [entity.id, currentMonth], err => callMessage(err, 'kpi'));
  const history = useLoad(async () => {
    const d = await cashHistoryData(entity.id);
    return cashHistory(d.months, d.rows, d.cashKeys);
  }, [entity.id], err => callMessage(err, 'kpi'));
  // Budgets and their saved scenarios (default: the latest budget that has any).
  const budgets = useLoad(async () => {
    const plan = await getPlan(entity.id);
    const list = await listBudgets(plan.id);
    const withScenarios = await Promise.all(list.map(async b => ({ ...b, scenarios: await listScenarios(b.id) })));
    return { plan, budgets: withScenarios };
  }, [entity.id], err => callMessage(err, 'budget'));
  const [versionChoice, setVersionChoice] = useState<string | null | undefined>(undefined);
  const defaultVersion = budgets.status === 'ok'
    ? [...budgets.data.budgets].reverse().find(b => b.scenarios.some(s => !s.is_base))?.id ?? null : null;
  const version = versionChoice === undefined ? defaultVersion : versionChoice;
  const scen = useLoad(async () => {
    if (budgets.status !== 'ok' || !version) return null;
    const b = budgets.data.budgets.find(x => x.id === version);
    if (!b) return null;
    const [lines, drivers, values] = await Promise.all([budgetLines(version), listDrivers(budgets.data.plan.id), listValues(b.scenarios.map(s => s.id))]);
    return { budget: b, lines, drivers, values };
  }, [version, budgets.status], err => callMessage(err, 'budget'));
  const [whatIf, setWhatIf] = useState<string | null>(null);

  // ── Not set up: nothing else is shown ──
  if (position.status === 'loading') return <p className="loading" role="status">Loading the cash figures…</p>;
  if (position.status === 'error') return <Failed message={`The cash figures could not be loaded. ${position.message}`} retry={position.reload} />;
  const { rows, actualsThrough, k } = position.data;
  if (rows.length === 0) {
    return (
      <div className="report" data-testid="cash-not-set-up">
        <p className="msg msg-warn">No month-end balances imported yet. Import them on <Link to={entityPath(entity.id, 'connect')}>Connect</Link> (choose "Month-end balances"), then map the bank accounts to Cash and bank.</p>
      </div>
    );
  }
  if (rows[0] && rows[0].cashAccounts === 0) {
    return (
      <div className="report" data-testid="cash-not-set-up">
        <p className="msg msg-warn">{NOT_SET_UP}: <Link to={`${entityPath(entity.id, 'connect')}/map`}>Map accounts</Link>.</p>
      </div>
    );
  }

  const latest = rows[0]?.latestMonth ?? null;
  const cashNow = k.cash.cents;
  const burn = k.burnCents;
  const typed = whatIf === null ? null : parseBurn(whatIf);
  const whatIfBurn = typed && 'cents' in typed ? typed.cents : null;
  const canProject = latest !== null && cashNow !== null && burn !== null;
  const trend = canProject ? projectCash(latest, cashNow, burn) : [];
  const whatIfLine = canProject && whatIfBurn !== null && whatIfBurn !== burn ? projectCash(latest, cashNow, whatIfBurn) : null;
  const hist: CashMonth[] = history.status === 'ok' ? history.data : [];
  const lastMonth = trend[trend.length - 1]?.month ?? latest;
  const firstMonth = hist[0]?.month ?? latest;

  // Scenarios: the existing engine for each scenario's net profit; the difference against Base adjusts the trend.
  const scenarioLines = scenarioLinesFor(scen.status === 'ok' ? scen.data : null, canProject && latest && cashNow !== null && burn !== null ? { latest, cashNow, burn } : null);
  const lines: Line[] = [
    ...(canProject ? [{ name: 'Current trend', points: trend, style: 'trend' as const, index: 0 }] : []),
    ...(whatIfLine ? [{ name: 'What-if (not saved)', points: whatIfLine, style: 'whatif' as const, index: 0 }] : []),
    ...(scenarioLines?.rows.filter(r => !r.isBase).map((r, i) => ({ name: r.name, points: r.points, style: 'scenario' as const, index: i + 1 })) ?? []),
  ];
  const quality = cashQualityNotes({
    balancesThrough: latest, actualsThrough, currentMonth, unmappedBalance: rows[0]?.unmappedAccounts ?? 0,
    missingMonthEnds: burn === null ? (k.runway.notes[0] ?? null) : null,
  }, monthLabel);

  return (
    <div className="report cash-page">
      <header className="report-head">
        <div>
          <div className="report-entity">{entity.name}</div>
          <h1 className="report-title">Cash: {firstMonth ? monthLabel(firstMonth) : ''} to {lastMonth ? monthLabel(lastMonth) : ''}</h1>
          <p className="f-hint" data-testid="cash-generated">Generated {dateTime(generatedAt)} by {generatedBy}.</p>
          <p className="f-hint" data-testid="cash-sources">
            {latest ? `Balances through ${monthLabel(latest)}.` : 'No month-end balances imported yet.'} {actualsThrough ? `Actuals through ${monthLabel(actualsThrough)}.` : 'No actuals imported yet.'}
          </p>
        </div>
        <div className="row-gap no-print">
          <button type="button" className="btn btn-p" onClick={() => window.print()}>Print / save as PDF</button>
          <button type="button" className="btn btn-s btn-sm" disabled={history.status !== 'ok'}
            onClick={() => downloadCSV(`cash-${(latest ?? '').slice(0, 7)}.csv`, cashCsvRows(hist, lines.map(l => ({ name: l.name, points: l.points }))))}>Download CSV</button>
        </div>
      </header>

      <Section title="1. Cash now" id={`${ids}-s1`}>
        <div className="kpi-grid report-kpis" data-testid="cash-now">
          <Tile label="Cash balance" value={money(cashNow)} notes={k.cash.notes} />
          <Tile label="Net cash burn (a month)" value={burn === null ? '—' : money(burn)} notes={burn === null ? [k.runway.notes[0] ?? ''] : [BURN_LABEL, ...k.runway.notes.filter(n => n.startsWith('Over '))]} />
          <Tile label="Runway (months)" value={k.runway.text ?? '—'} notes={k.runway.notes.filter(n => !n.includes('/month') && !n.startsWith('Over '))} />
        </div>
      </Section>

      <Section title="2. History and projection" id={`${ids}-s2`}>
        {history.status === 'loading' && <p className="loading" role="status">Loading the month-end cash…</p>}
        {history.status === 'error' && <Failed message={`The month-end cash could not be loaded. ${history.message}`} retry={history.reload} />}
        {history.status === 'ok' && (
          <>
            {!canProject && <p className="msg msg-warn" style={{ marginBottom: 8 }}>No projection: {k.runway.notes[0] ?? 'the net cash burn is not known'}.</p>}
            {canProject && (
              <p data-testid="runs-out" style={{ marginBottom: 6 }}>
                <strong>Current trend:</strong> {runsOut(trend) ? <>cash runs out in <strong>{runsOutText(runsOut(trend), monthLabel)}</strong> (month {runsOut(trend)?.k})</> : runsOutText(null, monthLabel)}.
                {whatIfLine && <> <strong>What-if (not saved):</strong> {runsOut(whatIfLine) ? `runs out in ${runsOutText(runsOut(whatIfLine), monthLabel)}` : runsOutText(null, monthLabel)}.</>}
              </p>
            )}
            <CashChart history={hist} lines={lines} money={money} />
            <CashTable history={hist} lines={lines} money={money} />
          </>
        )}
      </Section>

      <Section title="3. Scenarios as cash" id={`${ids}-s3`}>
        <div className="no-print f-group" style={{ maxWidth: 360, marginBottom: 8 }}>
          <label className="f-label" htmlFor={`${ids}-b`}>Budget</label>
          <select id={`${ids}-b`} className="f-input" value={version ?? ''} onChange={e => setVersionChoice(e.target.value || null)} disabled={budgets.status !== 'ok'}>
            <option value="">No budget</option>
            {budgets.status === 'ok' && budgets.data.budgets.map(b => <option key={b.id} value={b.id}>{b.name}{b.locked_at ? ' (locked)' : ''}{b.scenarios.some(s => !s.is_base) ? '' : ' (no scenarios)'}</option>)}
          </select>
        </div>
        {budgets.status === 'error' ? <Failed message={`The budgets could not be loaded. ${budgets.message}`} retry={budgets.reload} />
          : budgets.status === 'loading' || scen.status === 'loading' ? <p className="loading" role="status">Loading the scenarios…</p>
          : scen.status === 'error' ? <Failed message={`The scenarios could not be loaded. ${scen.message}`} retry={scen.reload} />
          : !version ? <p data-testid="cash-no-scenarios">—: no budget chosen{budgets.data.budgets.some(b => b.scenarios.some(s => !s.is_base)) ? '' : ' (no budget has saved scenarios)'}.</p>
          : !scenarioLines ? <p data-testid="cash-no-scenarios">—: {canProject ? 'this budget has no saved scenarios.' : 'there is no projection to adjust (see above).'}</p>
          : <ScenarioCashTable data={scenarioLines} money={money} />}
      </Section>

      <Section title="4. What-if (not saved)" id={`${ids}-s4`}>
        {!canProject ? <p className="f-hint">—: there is no net cash burn to change (see above).</p> : (
          <div className="no-print">
            <div className="row-gap" style={{ alignItems: 'flex-end' }}>
              <div className="f-group" style={{ maxWidth: 240, marginBottom: 0 }}>
                <label className="f-label" htmlFor={`${ids}-w`}>Monthly net cash burn</label>
                <input id={`${ids}-w`} className="f-input mono" inputMode="decimal" value={whatIf ?? (burn !== null ? (Number(burn) / 100).toFixed(2) : '')}
                  onChange={e => setWhatIf(e.target.value)} />
              </div>
              <button type="button" className="btn btn-s btn-sm" disabled={whatIf === null} onClick={() => setWhatIf(null)}>Reset</button>
            </div>
            {typed && 'problem' in typed && <p className="msg msg-error" role="alert" style={{ marginTop: 6 }}>{typed.problem}</p>}
            <p className="f-hint" style={{ marginTop: 6 }}>Changes the dotted "What-if (not saved)" line only, in this browser. Nothing is saved.</p>
          </div>
        )}
        {whatIfLine && <p className="print-only">What-if (not saved): a net cash burn of {money(whatIfBurn)} a month.</p>}
      </Section>

      <Section title="5. Data quality and notes" id={`${ids}-s5`}>
        <div data-testid="cash-quality">
          {quality.length === 0 ? <p>None</p> : <ul className="report-notes">{quality.map(n => <li key={n}>{n}</li>)}</ul>}
          {history.status === 'error' && <p className="msg msg-warn">The month-end cash history could not be checked.</p>}
          <p className="f-hint" style={{ marginTop: 8 }}>{CASH_FOOTNOTE}</p>
        </div>
      </Section>
    </div>
  );
}

function Tile({ label, value, notes }: { label: string; value: string; notes: string[] }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value${value === '—' ? '' : ' kpi-live'}`} aria-label={value === '—' ? 'No figure' : undefined}>{value}</div>
      {notes.filter(Boolean).map(n => <div className="kpi-sub" key={n}>{n}</div>)}
    </div>
  );
}

interface ScenarioRow { name: string; isBase: boolean; diff: bigint; points: ProjectedMonth[] }
interface ScenarioLines { budgetName: string; yearFrom: Period; rows: ScenarioRow[] }

function scenarioLinesFor(data: { budget: { name: string; scenarios: { id: string; name: string; is_base: boolean }[] }; lines: BudgetLine[]; drivers: { id: string; key: string }[]; values: { driver_id: string; scenario_id: string; value: number | string }[] } | null,
  start: { latest: Period; cashNow: bigint; burn: bigint } | null): ScenarioLines | null {
  {
    if (!data || !start || !data.budget.scenarios.some(s => !s.is_base)) return null;
    const periods = [...new Set(data.lines.map(l => l.period))].sort();
    const yearFrom = periods[0];
    if (!yearFrom) return null;
    const months = Array.from({ length: 12 }, (_, i) => addMonths(yearFrom, i));
    const base = new Map<string, bigint[]>();
    for (const line of BUDGET_LINES) base.set(line, months.map(m => {
      const l = data.lines.find(x => x.plan_line === line && x.period === m);
      return l && l.amount !== null ? toCents(l.amount) : 0n;
    }));
    const keyOf = new Map(data.drivers.map(d => [d.id, DRIVER_KEYS.find(k => DRIVER_DEFS[k].key === d.key)]));
    const driversFor = (id: string, isBase: boolean): Drivers | null => {
      if (isBase) return NO_CHANGE;
      const out = { ...NO_CHANGE };
      for (const v of data.values.filter(x => x.scenario_id === id)) {
        const k = keyOf.get(v.driver_id);
        if (!k) continue;
        const p = parsePercent(stored(v.value));
        if ('problem' in p) return null;
        out[k] = p.bp;
      }
      return out;
    };
    const baseProfit = summariseScenario(applyScenario(base, NO_CHANGE), null).netProfit;
    const scenarios = [...data.budget.scenarios];
    if (!scenarios.some(s => s.is_base)) scenarios.unshift({ id: 'base', name: 'Base', is_base: true });
    const rows: ScenarioRow[] = [];
    for (const s of scenarios.sort(scenarioOrder)) {
      const d = driversFor(s.id, s.is_base);
      if (!d) continue;
      const diff = summariseScenario(applyScenario(base, d), null).netProfit - baseProfit;
      rows.push({ name: s.name, isBase: s.is_base, diff, points: projectCash(start.latest, start.cashNow, start.burn, diff) });
    }
    return { budgetName: data.budget.name, yearFrom, rows };
  }
}

function ScenarioCashTable({ data, money }: { data: ScenarioLines; money: (c: bigint | null) => string }) {
  const at = (pts: ProjectedMonth[], k: number) => pts.find(p => p.k === k)?.cash ?? null;
  return (
    <>
      <div className="table-wrap">
        <table className="gl-table report-table" aria-label="Scenarios as cash" data-testid="cash-scenarios">
          <thead><tr><th scope="col">Scenario</th><th scope="col" className="r">Net profit against Base (a year)</th><th scope="col" className="r">Cash at month 6</th><th scope="col" className="r">Cash at month 12</th><th scope="col">Cash runs out</th></tr></thead>
          <tbody>
            {data.rows.map(r => {
              const out = runsOut(r.points);
              return (
                <tr key={r.name}>
                  <th scope="row">{r.name}{r.isBase && <span className="f-hint"> (the Current trend)</span>}</th>
                  <td className="r mono">{r.isBase ? '—' : `${r.diff > 0n ? '+' : ''}${money(r.diff)}`}</td>
                  <td className="r mono">{money(at(r.points, 6))}</td>
                  <td className="r mono">{money(at(r.points, 12))}</td>
                  <td>{out ? monthLabel(out.month) : 'Not within 12 months'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="f-hint" style={{ marginTop: 6 }}>
        Each scenario: the Current trend plus its yearly net profit against Base (from {data.budgetName}, {monthLabel(data.yearFrom)} to {monthLabel(addMonths(data.yearFrom, 11))}) spread evenly over the 12 projected months. {SCENARIO_CASH_LABEL}
      </p>
    </>
  );
}

const W = 640, H = 250, L = 80, R = 600, T = 18, B = 200;
const DASH: Record<Line['style'], string> = { trend: '6 4', whatif: '2 3', scenario: '10 4 2 4' };
const MARK = ['circle', 'square', 'triangle', 'diamond', 'cross'] as const;

function marker(kind: (typeof MARK)[number], x: number, y: number) {
  switch (kind) {
    case 'circle': return <circle cx={x} cy={y} r={3.2} />;
    case 'square': return <rect x={x - 3} y={y - 3} width={6} height={6} />;
    case 'triangle': return <polygon points={`${x},${y - 4} ${x + 4},${y + 3} ${x - 4},${y + 3}`} />;
    case 'diamond': return <polygon points={`${x},${y - 4} ${x + 4},${y} ${x},${y + 4} ${x - 4},${y}`} />;
    default: return <path d={`M${x - 3},${y - 3}L${x + 3},${y + 3}M${x - 3},${y + 3}L${x + 3},${y - 3}`} />;
  }
}

/** History (solid) then the projection lines (dashed, each its own pattern and marker, named in the legend). */
function CashChart({ history, lines, money }: { history: CashMonth[]; lines: Line[]; money: (c: bigint | null) => string }) {
  const months = [...history.map(h => h.month), ...(lines[0]?.points.map(p => p.month) ?? [])];
  if (months.length === 0) return <p className="f-hint">No month-end cash to show.</p>;
  const scale = linearScale([...history.map(h => h.cash), ...lines.flatMap(l => l.points.map(p => p.cash))], T, B);
  const x = (m: Period) => { const i = months.indexOf(m); return months.length === 1 ? (L + R) / 2 : L + (i * (R - L)) / (months.length - 1); };
  const lastHist = history[history.length - 1];
  const trendOut = lines.find(l => l.style === 'trend') ? runsOut(lines.find(l => l.style === 'trend')?.points ?? []) : null;
  const ticks = [scale.max, 0, scale.min].filter((v, i, a) => a.indexOf(v) === i);
  const desc = `Month-end cash: ${history.map(h => `${monthLabel(h.month)} ${money(h.cash)}`).join(', ')}. ${lines.map(l => `${l.name}: ${l.points.map(p => `${monthLabel(p.month)} ${money(p.cash)}`).join(', ')}`).join('. ')}`;
  return (
    <figure className="report-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc} preserveAspectRatio="xMidYMid meet">
        {ticks.map(v => {
          const y = scale.y(BigInt(Math.round(v * 100)));
          return <g key={v}><line x1={L} x2={R} y1={y} y2={y} className={v === 0 ? 'axis-zero' : 'grid'} /><text x={L - 6} y={y + 4} textAnchor="end" className="tick">{`${v < 0 ? '-' : ''}€${Math.round(Math.abs(v)).toLocaleString('en-IE')}`}</text></g>;
        })}
        {lastHist && lines.length > 0 && (
          <g className="proj-zone">
            <line x1={x(lastHist.month)} x2={x(lastHist.month)} y1={T} y2={B} className="grid" />
            <text x={x(lastHist.month) + 6} y={T + 10} className="tick">Projection (not a forecast) →</text>
          </g>
        )}
        {months.map((m, i) => (i % 2 === 0 || i === months.length - 1) && <text key={m} x={x(m)} y={B + 16} textAnchor="middle" className="tick">{monthLabel(m).slice(0, 3)} {m.slice(2, 4)}</text>)}
        <g className="series series-revenue series-actual">
          <polyline points={history.map(h => `${x(h.month)},${scale.y(h.cash)}`).join(' ')} fill="none" />
          {history.map(h => <circle key={h.month} cx={x(h.month)} cy={scale.y(h.cash)} r={3.2} />)}
        </g>
        {lines.map(l => {
          const pts = lastHist ? [{ month: lastHist.month, cash: lastHist.cash }, ...l.points] : l.points;
          const cls = l.style === 'scenario' ? `series series-scn-${l.index % 4}` : `series series-net-profit series-${l.style}`;
          return (
            <g key={l.name} className={cls} strokeDasharray={DASH[l.style]}>
              <polyline points={pts.map(p => `${x(p.month)},${scale.y(p.cash)}`).join(' ')} fill="none" />
              <g strokeDasharray="none">{l.points.map(p => <g key={p.month}>{marker(MARK[(l.index + (l.style === 'whatif' ? 3 : 1)) % MARK.length] ?? 'circle', x(p.month), scale.y(p.cash))}</g>)}</g>
            </g>
          );
        })}
        {trendOut && (
          <g className="runs-out">
            <line x1={x(trendOut.month)} x2={x(trendOut.month)} y1={T} y2={B} strokeDasharray="3 3" />
            <text x={x(trendOut.month) + 4} y={B - 6} className="tick">Cash runs out: {monthLabel(trendOut.month)}</text>
          </g>
        )}
      </svg>
      <figcaption className="report-legend">
        <span className="legend-item series-revenue series-actual"><svg width="26" height="10" aria-hidden="true"><line x1="1" x2="25" y1="5" y2="5" /><circle cx="13" cy="5" r="3" /></svg>Month-end cash (history)</span>
        {lines.map(l => (
          <span key={l.name} className={`legend-item ${l.style === 'scenario' ? `series-scn-${l.index % 4}` : `series-net-profit series-${l.style}`}`}>
            <svg width="26" height="10" aria-hidden="true"><line x1="1" x2="25" y1="5" y2="5" strokeDasharray={DASH[l.style]} /></svg>
            {l.name} ({l.style === 'whatif' ? 'dotted' : 'dashed'})
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** The chart's text alternative: every month and value, history then projection. */
function CashTable({ history, lines, money }: { history: CashMonth[]; lines: Line[]; money: (c: bigint | null) => string }) {
  const months = [...history.map(h => h.month), ...(lines[0]?.points.map(p => p.month) ?? [])];
  return (
    <div className="table-wrap" style={{ marginTop: 8 }}>
      <table className="gl-table report-table" aria-label="Month-end cash and projection" data-testid="cash-table">
        <thead><tr><th scope="col">Month</th><th scope="col" className="r">Month-end cash</th>{lines.map(l => <th scope="col" className="r" key={l.name}>{l.name}</th>)}</tr></thead>
        <tbody>
          {months.map(m => {
            const h = history.find(x => x.month === m);
            return (
              <tr key={m}>
                <th scope="row">{monthLabel(m)}{!h && <span className="f-hint"> (projection)</span>}</th>
                <td className="r mono">{h ? money(h.cash) : ''}</td>
                {lines.map(l => { const p = l.points.find(x => x.month === m); return <td className="r mono" key={l.name}>{p ? money(p.cash) : ''}</td>; })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
