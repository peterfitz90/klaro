// Scenarios (Phase 3 slice, behind SCENARIOS_LIVE): for the selected budget and the year shown,
// Base (the budget as it is) and up to four more scenarios, each with three drivers entered as
// percentages. A comparison table gives Revenue, Total costs and Net profit for the year, plus an
// INDICATIVE closing cash at month 12 (the latest cash balance + the year's net profit; "—"
// without a cash balance). All maths in src/engine/scenarios.ts.
// Saved in the existing fpa.scenarios / fpa.drivers / fpa.driver_values tables (./scenariosApi.ts).
// Upside and Downside are offered by default and saved when Save is pressed; nothing is written
// just by opening the panel. Read-only for viewers and for locked budgets (the database refuses
// writes to a locked version anyway). A save that fails partway says so and shows what is saved.
import { useEffect, useId, useMemo, useState } from 'react';
import {
  applyScenario, cashKpis, DRIVER_DEFS, DRIVER_KEYS, formatMoney, INDICATIVE_LABEL, monthOf, NO_CHANGE, parsePercent, percentText, summarise, toCents,
  type DriverKey, type Drivers, type Period,
} from '../../engine';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { cashPosition } from '../connect/api';
import { monthLabel } from '../connect/format';
import type { Entity, Role } from '../entities/model';
import type { BudgetLine, Plan, Version } from './api';
import {
  addScenarios, deleteScenario, ensureDrivers, insertValues, listDrivers, listScenarios, listValues, MAX_SCENARIOS, renameScenario, updateValue,
} from './scenariosApi';

const BUDGET_LINES = ['revenue', 'cost_of_sales', 'payroll', 'marketing', 'premises', 'other_operating', 'interest', 'tax'];
type Inputs = Record<DriverKey, string>;
interface Row { key: string; id: string | null; name: string; savedName: string | null; isBase: boolean; inputs: Inputs; savedBp: Partial<Record<DriverKey, bigint>> }
const ZERO: Inputs = { revenue: '0', payroll: '0', other: '0' };

export interface ScenariosPanelProps {
  entity: Entity;
  plan: Plan;
  version: Version;
  role: Role;
  /** The budget's saved lines (base scenario), and the months of the year shown. */
  lines: BudgetLine[];
  months: Period[];
  today?: Date;
}

export function ScenariosPanel({ entity, plan, version, role, lines, months, today }: ScenariosPanelProps) {
  const ids = useId();
  const locked = version.locked_at !== null;
  const canEdit = (role === 'owner' || role === 'editor') && !locked;
  const load = useLoad(async () => {
    const [scenarios, drivers] = await Promise.all([listScenarios(version.id), listDrivers(plan.id)]);
    const values = await listValues(scenarios.map(s => s.id));
    let cash: bigint | null = null, cashMonth: Period | null = null, cashError: string | null = null;
    try {
      const k = cashKpis(await cashPosition(entity.id), { currentMonth: monthOf(today ?? new Date()), actualsThrough: null, currency: entity.currency });
      cash = k.cash.cents;
      cashMonth = cash === null ? null : (k.cash.notes.find(n => n.startsWith('Balances through')) ?? null);
    } catch (err) { cashError = callMessage(err, 'kpi'); }
    return { scenarios, drivers, values, cash, cashMonth, cashError };
  }, [version.id, plan.id, entity.id], err => callMessage(err, 'budget'));

  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // The rows on screen start from what is saved (and the two defaults when nothing else is). Keyed
  // on the loaded data itself (a new object only when a load finishes), not on the load wrapper.
  const loaded = load.status === 'ok' ? load.data : null;
  useEffect(() => {
    if (!loaded) return;
    const { scenarios, drivers, values } = loaded;
    const driverKey = new Map(drivers.map(d => [d.id, DRIVER_KEYS.find(k => DRIVER_DEFS[k].key === d.key)]));
    const out: Row[] = scenarios.map(s => {
      const savedBp: Partial<Record<DriverKey, bigint>> = {};
      const inputs: Inputs = { ...ZERO };
      for (const v of values.filter(x => x.scenario_id === s.id)) {
        const k = driverKey.get(v.driver_id);
        if (!k || k in savedBp) continue;
        const r = parsePercent(String(v.value));
        inputs[k] = 'bp' in r ? percentText(r.bp) : String(v.value);
        if ('bp' in r) savedBp[k] = r.bp;
      }
      return { key: s.id, id: s.id, name: s.name, savedName: s.name, isBase: s.is_base, inputs, savedBp };
    });
    if (!out.some(r => r.isBase)) out.unshift({ key: 'base', id: null, name: 'Base', savedName: null, isBase: true, inputs: { ...ZERO }, savedBp: {} });
    if (!out.some(r => !r.isBase)) {
      out.push({ key: 'new-upside', id: null, name: 'Upside', savedName: null, isBase: false, inputs: { ...ZERO }, savedBp: {} });
      out.push({ key: 'new-downside', id: null, name: 'Downside', savedName: null, isBase: false, inputs: { ...ZERO }, savedBp: {} });
    }
    setRows(out);
  }, [loaded]);

  // The budget year's lines, month by month (stored sign, cents); a missing month counts as 0.
  const base = useMemo(() => {
    const map = new Map<string, bigint[]>();
    for (const line of BUDGET_LINES) map.set(line, months.map(m => {
      const l = lines.find(x => x.plan_line === line && x.period === m);
      return l && l.amount !== null ? toCents(l.amount) : 0n;
    }));
    return map;
  }, [lines, months]);
  const hasLines = lines.some(l => months.includes(l.period));

  if (load.status === 'loading') return <p className="loading" role="status">Loading the scenarios…</p>;
  if (load.status === 'error') {
    return (
      <div role="alert" style={{ marginTop: 16 }}>
        <p className="msg msg-error">The scenarios could not be loaded. {load.message}</p>
        <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={load.reload}>Try again</button>
      </div>
    );
  }
  const { cash, cashMonth, cashError } = load.data;

  const driversOf = (r: Row): Drivers | string => {
    if (r.isBase) return NO_CHANGE;
    const d = { ...NO_CHANGE };
    for (const k of DRIVER_KEYS) {
      const p = parsePercent(r.inputs[k]);
      if ('problem' in p) return `${DRIVER_DEFS[k].label}: ${p.problem}`;
      d[k] = p.bp;
    }
    return d;
  };
  const dirty = rows.some(r => !r.isBase && (r.id === null || r.name !== r.savedName || DRIVER_KEYS.some(k => {
    const p = parsePercent(r.inputs[k]);
    return !('bp' in p) || p.bp !== (r.savedBp[k] ?? 0n) || !(k in r.savedBp);
  })));
  const setRow = (key: string, patch: Partial<Row>) => { setNotice(null); setRows(prev => prev.map(r => (r.key === key ? { ...r, ...patch } : r))); };
  const money = (c: bigint | null) => (c === null ? '—' : formatMoney(c, entity.currency));

  async function save() {
    const bad: string[] = [];
    const names = new Set<string>();
    for (const r of rows) {
      const n = r.name.trim();
      if (n.length < 1 || n.length > 80) bad.push(`A scenario name must be 1 to 80 characters.`);
      if (names.has(n.toLowerCase())) bad.push(`Two scenarios are called "${n}".`);
      names.add(n.toLowerCase());
      const d = driversOf(r);
      if (typeof d === 'string') bad.push(`${r.name}: ${d}`);
    }
    setProblems(bad);
    if (bad.length || !months[0]) return;
    setBusy(true); setNotice(null);
    try {
      const driverIds = await ensureDrivers(plan.id);
      const created = await addScenarios(version.id, rows.filter(r => !r.isBase && r.id === null).map(r => r.name.trim()));
      const idOf = (r: Row) => r.id ?? created.find(c => c.name === r.name.trim())?.id ?? null;
      for (const r of rows) if (!r.isBase && r.id !== null && r.name.trim() !== r.savedName) await renameScenario(r.id, r.name.trim());
      const scenarioIds = rows.filter(r => !r.isBase).map(idOf).filter((x): x is string => x !== null);
      const saved = await listValues(scenarioIds);
      const inserts: { driver_id: string; scenario_id: string; period: Period; value: string }[] = [];
      const updates: { id: string; value: string }[] = [];
      for (const r of rows.filter(x => !x.isBase)) {
        const sid = idOf(r);
        const d = driversOf(r);
        if (!sid || typeof d === 'string') continue;
        for (const k of DRIVER_KEYS) {
          const value = percentText(d[k]);
          const existing = saved.find(v => v.scenario_id === sid && v.driver_id === driverIds[k]);
          if (!existing) inserts.push({ driver_id: driverIds[k], scenario_id: sid, period: months[0], value });
          else {
            const p = parsePercent(String(existing.value));
            if (!('bp' in p) || p.bp !== d[k]) updates.push({ id: existing.id, value });
          }
        }
      }
      await insertValues(inserts);
      for (const u of updates) await updateValue(u.id, u.value);
      setNotice({ ok: true, text: 'Scenarios saved.' });
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      const msg = code === 'PT423' ? 'This budget is locked, so its scenarios cannot be changed.' : callMessage(err, 'budget').replace(/ ?Nothing was changed\./, '');
      setNotice({ ok: false, text: `Not everything was saved: ${msg} The table now shows what is saved.` });
    } finally {
      setBusy(false);
      load.reload();
    }
  }

  async function remove(r: Row) {
    setConfirmDelete(null);
    if (r.id === null) { setRows(prev => prev.filter(x => x.key !== r.key)); return; }
    setBusy(true); setNotice(null);
    try { await deleteScenario(r.id); setNotice({ ok: true, text: `${r.savedName ?? r.name} deleted.` }); } catch (err) {
      setNotice({ ok: false, text: `${r.savedName ?? r.name} was not deleted: ${callMessage(err, 'budget')}` });
    } finally { setBusy(false); load.reload(); }
  }

  function add() {
    setNotice(null);
    let n = rows.length;
    let name = `Scenario ${n}`;
    while (rows.some(r => r.name.trim().toLowerCase() === name.toLowerCase())) name = `Scenario ${++n}`;
    setRows(prev => [...prev, { key: `new-${Date.now()}`, id: null, name, savedName: null, isBase: false, inputs: { ...ZERO }, savedBp: {} }]);
  }

  return (
    <section aria-labelledby={`${ids}-t`} style={{ marginTop: 24 }} data-testid="scenarios-panel">
      <h3 className="step-title" id={`${ids}-t`}>Scenarios: {months[0] ? `${monthLabel(months[0])} to ${monthLabel(months[months.length - 1] ?? months[0])}` : ''}</h3>
      <p className="f-hint" style={{ marginBottom: 8 }}>
        Base is this budget as it is. Each driver changes every month of the year: revenue change % moves Revenue and Cost of sales;
        payroll change % moves Payroll; other costs change % moves Other operating costs. Marketing, Rent and premises, Interest and Tax are unchanged.
      </p>
      {locked && <p className="msg msg-warn" style={{ marginBottom: 8 }}>This budget is locked: you can see its scenarios, but they cannot be changed or saved.</p>}
      {!locked && !canEdit && <p className="msg msg-warn" style={{ marginBottom: 8 }}>You can see the scenarios. Changing them needs editor or owner access to {entity.name}.</p>}
      {!hasLines && <p className="msg msg-warn">This budget has no lines in this year, so there is nothing to compare.</p>}
      {notice && <p className={`msg ${notice.ok ? 'msg-ok' : 'msg-error'}`} role={notice.ok ? 'status' : 'alert'} style={{ marginBottom: 8 }}>{notice.text}</p>}
      {problems.length > 0 && (
        <div className="msg msg-error" role="alert" style={{ marginBottom: 8 }}>
          Nothing was saved. Fix these first:<ul style={{ margin: '6px 0 0 18px' }}>{problems.map(p => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {hasLines && (
        <div className="table-wrap">
          <table className="gl-table" aria-label="Scenarios compared">
            <thead>
              <tr>
                <th scope="col">Scenario</th>
                {DRIVER_KEYS.map(k => <th scope="col" className="r" key={k}>{DRIVER_DEFS[k].label} %</th>)}
                <th scope="col" className="r">Revenue</th>
                <th scope="col" className="r">Total costs</th>
                <th scope="col" className="r">Net profit</th>
                <th scope="col" className="r">Closing cash, month 12 (indicative)</th>
                {canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const d = driversOf(r);
                const s = typeof d === 'string' ? null : summarise(applyScenario(base, d), cash);
                return (
                  <tr key={r.key} data-testid={`scenario-${r.name}`}>
                    <td>
                      {r.isBase || !canEdit ? <strong>{r.name}</strong> : (
                        <>
                          <label className="sr-only" htmlFor={`${ids}-${r.key}-name`}>Scenario name</label>
                          <input id={`${ids}-${r.key}-name`} className="f-input f-input-sm" value={r.name} maxLength={80} disabled={busy}
                            onChange={e => setRow(r.key, { name: e.target.value })} aria-label={`Name of ${r.savedName ?? r.name}`} />
                        </>
                      )}
                      {r.isBase && <div className="f-hint">the budget as it is</div>}
                      {!r.isBase && r.id === null && <div className="f-hint">not saved yet</div>}
                    </td>
                    {DRIVER_KEYS.map(k => (
                      <td className="r" key={k}>
                        {r.isBase ? <span className="mono">0</span> : (
                          <input className="f-input f-input-sm mono" style={{ width: 72, textAlign: 'right' }} inputMode="decimal" value={r.inputs[k]}
                            disabled={!canEdit || busy} aria-label={`${r.name}: ${DRIVER_DEFS[k].label} %`}
                            onChange={e => setRow(r.key, { inputs: { ...r.inputs, [k]: e.target.value } })} />
                        )}
                      </td>
                    ))}
                    {s === null ? (
                      <td colSpan={4} className="r"><span className="msg-error-text" role="note">{d as string}</span></td>
                    ) : (
                      <>
                        <td className="r mono">{money(s.revenue)}</td>
                        <td className="r mono">{money(s.costs)}</td>
                        <td className="r mono">{money(s.netProfit)}</td>
                        <td className="r mono">{money(s.closingCash)}</td>
                      </>
                    )}
                    {canEdit && (
                      <td>
                        {!r.isBase && (confirmDelete === r.key ? (
                          <span className="row-gap">
                            <button type="button" className="btn btn-s btn-xs" disabled={busy} onClick={() => remove(r)}>{r.id ? 'Delete it' : 'Remove it'}</button>
                            <button type="button" className="btn btn-s btn-xs" onClick={() => setConfirmDelete(null)}>Keep</button>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-s btn-xs" disabled={busy} onClick={() => setConfirmDelete(r.key)} aria-label={`Delete ${r.name}`}>Delete</button>
                        ))}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="f-hint" style={{ marginTop: 6 }} data-testid="indicative-note">
        Closing cash, month 12 = the latest cash balance{cash !== null && cashMonth ? ` (${money(cash)}, ${cashMonth.replace('Balances through', 'at the end of')})` : ''} + the year's net profit;{' '}
        {INDICATIVE_LABEL}.
        {cash === null && !cashError && ' It shows "—" because there is no cash balance: import month-end balances and map the bank accounts to Cash and bank.'}
        {cashError && ` It shows "—" because the cash balance could not be loaded. ${cashError}`}
      </p>
      {canEdit && hasLines && (
        <div className="row-gap" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-p" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save scenarios'}</button>
          <button type="button" className="btn btn-s btn-sm" disabled={busy || rows.length >= MAX_SCENARIOS} onClick={add}>Add a scenario</button>
          {rows.length >= MAX_SCENARIOS && <span className="f-hint">At most {MAX_SCENARIOS} scenarios, Base included.</span>}
          {dirty && !busy && <span className="f-hint">Unsaved changes.</span>}
        </div>
      )}
    </section>
  );
}
