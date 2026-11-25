// Build a budget from 12 months of actuals (Phase 1, step 1D): choose the window and where the budget
// starts, an uplift per line, see the result line by line, then create it (or rebuild an existing
// version, which first says how many lines will be replaced and how many were edited by hand, and
// asks for an explicit yes: docs/ui-rules.md section 4). A locked version cannot be rebuilt.
import { useId, useMemo, useState } from 'react';
import { addMonths, formatMoney, parseUplift, previewLine, toLines, type Period } from '../../engine';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { Entity } from '../entities/model';
import type { PlanLineDef } from '../connect/api';
import { monthLabel, plural } from '../connect/format';
import { createBudget, linesToReplace, variance, type Plan, type Version } from './api';

export interface BudgetBuilderProps {
  entity: Entity;
  plan: Plan;
  defs: PlanLineDef[];
  /** The latest month with actuals. */
  latestMonth: Period;
  /** The version to rebuild, or null for a new budget. */
  version: Version | null;
  /** For a rebuild: the first month the version already has. */
  defaultBudgetFrom?: Period;
  onDone: (versionId: string) => void;
  onCancel: () => void;
}

const bpText = (bp: bigint) => {
  const neg = bp < 0n;
  const abs = neg ? -bp : bp;
  return `${neg ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
};

export function BudgetBuilder(props: BudgetBuilderProps) {
  const { entity, plan, defs, latestMonth, version } = props;
  const ids = useId();
  const lines = defs.filter(d => d.kind === 'income' || d.kind === 'cost');
  const windowOptions = useMemo(() => {
    const out: Period[] = [];
    for (let k = -35; k <= -11; k++) { const p = addMonths(latestMonth, k); if (p >= '2000-01-01') out.push(p); }
    return out;
  }, [latestMonth]);
  const [windowFrom, setWindowFrom] = useState<Period>(addMonths(latestMonth, -11));
  const [budgetFrom, setBudgetFrom] = useState<Period>(props.defaultBudgetFrom ?? addMonths(latestMonth, 1));
  const [name, setName] = useState(`Budget ${monthLabel(props.defaultBudgetFrom ?? addMonths(latestMonth, 1))} to ${monthLabel(addMonths(props.defaultBudgetFrom ?? addMonths(latestMonth, 1), 11))}`);
  const [uplifts, setUplifts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ total: number; manual: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const budgetOptions = useMemo(() => {
    const out: Period[] = [];
    for (let k = 0; k <= 36; k++) out.push(addMonths(windowFrom, k));
    if (props.defaultBudgetFrom && !out.includes(props.defaultBudgetFrom)) out.unshift(props.defaultBudgetFrom);
    return out;
  }, [windowFrom, props.defaultBudgetFrom]);
  const windowTo = addMonths(windowFrom, 11);
  const locked = version?.locked_at != null;

  const actuals = useLoad(() => variance(entity.id, null, windowFrom, windowTo), [entity.id, windowFrom], err => callMessage(err, 'budget'));

  const view = useMemo(() => {
    if (actuals.status !== 'ok') return null;
    const byLine = new Map(toLines(actuals.data).map(l => [l.key, l]));
    const windowMonths = Array.from({ length: 12 }, (_, k) => addMonths(windowFrom, k));
    const missing = windowMonths.filter(m => [...byLine.values()].every(l => l.months.get(m)?.actual == null));
    const unmappedCents = windowMonths.reduce((s, m) => s + (byLine.get('unmapped')?.months.get(m)?.actual ?? 0n), 0n);
    const unmappedAny = windowMonths.some(m => (byLine.get('unmapped')?.months.get(m)?.actual ?? 0n) !== 0n);
    const rows = lines.map(d => {
      const parsed = parseUplift(uplifts[d.key] ?? '');
      const actual = windowMonths.map(m => byLine.get(d.key)?.months.get(m)?.actual ?? 0n);
      const preview = 'bp' in parsed ? previewLine(actual, parsed.bp) : null;
      return { def: d, parsed, preview };
    });
    // Net profit in display sign: income lines add, cost lines subtract.
    const net = (pick: (p: NonNullable<(typeof rows)[number]['preview']>) => bigint) =>
      rows.every(r => r.preview) ? rows.reduce((s, r) => s + (r.def.kind === 'income' ? 1n : -1n) * pick(r.preview as NonNullable<typeof r.preview>), 0n) : null;
    return { rows, missing, unmappedAny, unmappedCents, netActual: net(p => p.actualTotal), netBudget: net(p => p.budgetTotal) };
  }, [actuals, lines, uplifts, windowFrom]);

  const upliftProblems = view ? view.rows.filter(r => 'problem' in r.parsed) : [];
  const nameProblem = !version && (name.trim().length < 1 || name.trim().length > 120) ? 'Enter a name of 1 to 120 characters.' : null;
  const blocked = !view || view.missing.length > 0 || view.unmappedAny || upliftProblems.length > 0 || nameProblem !== null || locked || busy;

  const sentUplifts = () => {
    const out: Record<string, string> = {};
    for (const r of view?.rows ?? []) if ('bp' in r.parsed && r.parsed.bp !== 0n) out[r.def.key] = bpText(r.parsed.bp);
    return out;
  };

  async function build() {
    setBusy(true); setError(null);
    try {
      const id = await createBudget({ planId: plan.id, versionId: version?.id ?? null, name: version ? null : name.trim(), actualsFrom: windowFrom, budgetFrom, uplifts: sentUplifts() });
      props.onDone(id);
    } catch (err) {
      setConfirm(null);
      setError((err as { code?: unknown }).code === 'PT423' ? 'This version is locked. Unlock it first.' : callMessage(err, 'budget'));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!version) { await build(); return; }
    setBusy(true); setError(null);
    try {
      setConfirm(await linesToReplace(version.id, budgetFrom, addMonths(budgetFrom, 11)));
    } catch (err) {
      setError(callMessage(err, 'budget'));
    } finally {
      setBusy(false);
    }
  }

  const money = (c: bigint | null) => (c === null ? '—' : formatMoney(c, entity.currency));

  return (
    <section className="card" aria-labelledby={`${ids}-t`} style={{ marginBottom: 16 }}>
      <div className="card-header"><h2 className="card-title" id={`${ids}-t`}>{version ? `Rebuild ${version.name} from actuals` : 'New budget from actuals'}</h2></div>
      <div className="card-body">
        {locked && <p className="msg msg-warn" role="alert" style={{ marginBottom: 12 }}>This version is locked. Unlock it first.</p>}
        <div className="grid-fields">
          {!version && (
            <div className="f-group">
              <label className="f-label" htmlFor={`${ids}-name`}>Name</label>
              <input id={`${ids}-name`} className="f-input" value={name} maxLength={120} onChange={e => setName(e.target.value)} />
            </div>
          )}
          <div className="f-group">
            <label className="f-label" htmlFor={`${ids}-win`}>Actuals: 12 months from</label>
            <select id={`${ids}-win`} className="f-input" value={windowFrom} onChange={e => { setWindowFrom(e.target.value); setConfirm(null); }}>
              {windowOptions.map(p => <option key={p} value={p}>{monthLabel(p)} to {monthLabel(addMonths(p, 11))}</option>)}
            </select>
          </div>
          <div className="f-group">
            <label className="f-label" htmlFor={`${ids}-bud`}>Budget: 12 months from</label>
            <select id={`${ids}-bud`} className="f-input" value={budgetFrom} onChange={e => { setBudgetFrom(e.target.value); setConfirm(null); }}>
              {budgetOptions.map(p => <option key={p} value={p}>{monthLabel(p)} to {monthLabel(addMonths(p, 11))}</option>)}
            </select>
          </div>
        </div>
        <p className="f-hint" style={{ marginBottom: 10 }}>
          Each line's budget is its actual for the same month times (1 + uplift). Months are rounded to cents and the last month takes the
          rest, so the months add up to the yearly figure. Revenue and profit are shown as positive numbers.
        </p>

        {actuals.status === 'loading' && <p className="loading" role="status">Loading the actuals…</p>}
        {actuals.status === 'error' && (
          <div role="alert"><p className="msg msg-error">The actuals could not be loaded. {actuals.message}</p>
            <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={actuals.reload}>Try again</button></div>
        )}
        {view && (
          <>
            {view.missing.length > 0 && (
              <p className="msg msg-warn" role="alert" style={{ marginBottom: 10 }}>
                No actuals for {view.missing.map(monthLabel).join(', ')}. A budget needs actuals for all 12 months of the window.
              </p>
            )}
            {view.unmappedAny && (
              <p className="msg msg-warn" role="alert" style={{ marginBottom: 10 }}>
                Some actuals in this window are not mapped to a plan line (net {money(view.unmappedCents)}). Map every account first, on Connect › Map accounts.
              </p>
            )}
            <div className="table-wrap">
              <table className="gl-table stack-table" aria-label="Budget by line">
                <thead><tr><th scope="col">Line</th><th scope="col" className="r">Actuals, 12 months</th><th scope="col">Uplift %</th><th scope="col" className="r">Budget, 12 months</th></tr></thead>
                <tbody>
                  {view.rows.map(r => (
                    <tr key={r.def.key}>
                      <th scope="row" style={{ fontWeight: 500 }}>{r.def.label}</th>
                      <td className="r mono" data-label="Actuals, 12 months">{money(r.preview?.actualTotal ?? null)}</td>
                      <td data-label="Uplift %">
                        <label className="sr-only" htmlFor={`${ids}-u-${r.def.key}`}>Uplift for {r.def.label}, percent</label>
                        <input id={`${ids}-u-${r.def.key}`} className="f-input f-input-sm" style={{ width: 96 }} inputMode="decimal" placeholder="0"
                          value={uplifts[r.def.key] ?? ''} disabled={locked} aria-invalid={'problem' in r.parsed}
                          onChange={e => { setUplifts({ ...uplifts, [r.def.key]: e.target.value }); setConfirm(null); }} />
                        {'problem' in r.parsed && <div className="f-error">{r.parsed.problem}</div>}
                      </td>
                      <td className="r mono" data-label="Budget, 12 months">{money(r.preview?.budgetTotal ?? null)}</td>
                    </tr>
                  ))}
                  <tr className="row-total">
                    <th scope="row">Net profit</th>
                    <td className="r mono" data-label="Actuals, 12 months">{money(view.netActual)}</td><td className="stack-hide" />
                    <td className="r mono" data-label="Budget, 12 months">{money(view.netBudget)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {nameProblem && <p className="f-error" style={{ marginTop: 8 }}>{nameProblem}</p>}
        {error && <p className="msg msg-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}

        {confirm ? (
          <div className="msg msg-warn" role="alertdialog" aria-labelledby={`${ids}-c`} style={{ marginTop: 12 }}>
            <p id={`${ids}-c`} style={{ marginBottom: 8 }}>
              <strong>Rebuilding replaces {plural(confirm.total, 'line')} in {monthLabel(budgetFrom)} to {monthLabel(addMonths(budgetFrom, 11))}
              {confirm.manual > 0 ? `, including ${plural(confirm.manual, 'line')} edited by hand` : ', none of them edited by hand'}.</strong>{' '}
              This cannot be undone.
            </p>
            <div className="row-gap">
              <button type="button" className="btn btn-d" disabled={busy} onClick={build}>{busy ? 'Rebuilding…' : `Replace ${plural(confirm.total, 'line')}`}</button>
              <button type="button" className="btn btn-s btn-sm" disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="row-gap" style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-p" disabled={blocked} onClick={start}>
              {busy ? 'Working…' : version ? 'Rebuild…' : 'Create the budget'}
            </button>
            <button type="button" className="btn btn-s btn-sm" disabled={busy} onClick={props.onCancel}>Cancel</button>
          </div>
        )}
      </div>
    </section>
  );
}
