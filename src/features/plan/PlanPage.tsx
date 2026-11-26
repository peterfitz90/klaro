// Plan: the budgets (Phase 1, step 1D) and, for later, the drivers. A budget is built from 12 months
// of actuals with an uplift per line, edited by hand, locked by an editor or owner and unlocked only by
// an owner. Every load fails closed: an error is an error, never "no budgets".
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SCENARIOS_LIVE } from '../../app/shell/kpiSwitch';
import { EmptyState } from '../../app/shell/parts';
import { entityPath } from '../../app/shell/tasks';
import type { Period } from '../../engine';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { listConnections, listPlanLineDefs } from '../connect/api';
import { monthLabel } from '../connect/format';
import { useCurrentEntity } from '../entities/context';
import { getPlan, listBudgets, type Version } from './api';
import { BudgetBuilder } from './BudgetBuilder';
import { BudgetView } from './BudgetView';
import { latestActualsMonth } from './latest';

type Mode = { kind: 'view' } | { kind: 'new' } | { kind: 'rebuild'; firstMonth: Period | null };

export function PlanPage() {
  const { entity, role } = useCurrentEntity();
  const canEdit = role === 'owner' || role === 'editor';
  const load = useLoad(async () => {
    const plan = await getPlan(entity.id);
    const [defs, budgets, connections] = await Promise.all([listPlanLineDefs(), listBudgets(plan.id), listConnections(entity.id)]);
    return { plan, defs, budgets, latest: latestActualsMonth(connections) };
  }, [entity.id], err => callMessage(err, 'budget'));
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [changed, setChanged] = useState<Record<string, Version>>({});
  const [notice, setNotice] = useState<string | null>(null);
  // Bumped after every build or rebuild, so the budget view reads its lines again.
  const [revision, setRevision] = useState(0);

  const drivers = (
    <section className="card" aria-labelledby="drivers-title" style={{ marginBottom: 16 }}>
      <div className="card-header"><h2 className="card-title" id="drivers-title">Drivers</h2></div>
      <div className="card-body">
        <p className="f-hint" data-testid="drivers-text">{driversText(SCENARIOS_LIVE)}</p>
      </div>
    </section>
  );

  if (load.status === 'loading') return <>{drivers}<p className="loading" role="status">Loading the budgets…</p></>;
  if (load.status === 'error') {
    return (
      <>
        {drivers}
        <div role="alert"><p className="msg msg-error">The budgets could not be loaded. {load.message}</p>
          <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={load.reload}>Try again</button></div>
      </>
    );
  }
  const { plan, defs, latest } = load.data;
  const budgets = load.data.budgets.map(v => changed[v.id] ?? v);
  const current = budgets.find(v => v.id === selected) ?? budgets[budgets.length - 1] ?? null;
  // After a build or rebuild: close the form, say what happened, and read the budgets (and so the
  // grid) again.
  const done = (id: string, message: string) => { setSelected(id); setMode({ kind: 'view' }); setChanged({}); setNotice(message); setRevision(r => r + 1); load.reload(); };

  return (
    <>
      <section className="card" aria-labelledby="budgets-title" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 className="card-title" id="budgets-title">Budgets</h2></div>
        <div className="card-body">
          {latest === null ? (
            <EmptyState title="No actuals yet">
              <p>A budget is built from 12 months of actuals. Import them on <Link to={entityPath(entity.id, 'connect')}>Connect</Link> first.</p>
            </EmptyState>
          ) : (
            <p className="f-hint" style={{ marginBottom: 10 }}>Actuals through {monthLabel(latest)}.</p>
          )}
          {budgets.length > 0 && (
            <div className="row-gap" style={{ marginBottom: 10 }}>
              <label className="f-label" htmlFor="budget-pick">Budget</label>
              <select id="budget-pick" className="f-input f-input-sm" style={{ width: 'auto', minWidth: 220 }} value={current?.id ?? ''}
                onChange={e => { setSelected(e.target.value); setMode({ kind: 'view' }); }}>
                {budgets.map(v => <option key={v.id} value={v.id}>{v.name}{v.locked_at ? ' (locked)' : ''}</option>)}
              </select>
            </div>
          )}
          {budgets.length === 0 && latest !== null && <p className="f-hint" style={{ marginBottom: 10 }}>No budgets yet.</p>}
          {notice && <p className="msg msg-ok" role="status" style={{ marginBottom: 10 }}>{notice}</p>}
          {canEdit && latest !== null && mode.kind === 'view' && (
            <button type="button" className="btn btn-p" onClick={() => { setNotice(null); setMode({ kind: 'new' }); }}>New budget from actuals</button>
          )}
          {!canEdit && <p className="msg msg-warn">You can see the budgets. Building or changing one needs editor or owner access to {entity.name}.</p>}
        </div>
      </section>

      {mode.kind === 'new' && latest !== null && (
        <BudgetBuilder entity={entity} plan={plan} defs={defs} latestMonth={latest} version={null} onDone={done} onCancel={() => setMode({ kind: 'view' })} />
      )}
      {mode.kind === 'rebuild' && latest !== null && current && (
        <BudgetBuilder key={`rebuild-${current.id}`} entity={entity} plan={plan} defs={defs} latestMonth={latest} version={current}
          defaultBudgetFrom={mode.firstMonth ?? undefined} onDone={done} onCancel={() => setMode({ kind: 'view' })} />
      )}
      {mode.kind === 'rebuild' && latest === null && <p className="msg msg-warn">A rebuild needs actuals. Import them on Connect first.</p>}
      {current && (
        <BudgetView key={`view-${current.id}-${revision}`} entity={entity} plan={plan} defs={defs} version={current} role={role}
          onRebuild={firstMonth => { setNotice(null); setMode({ kind: 'rebuild', firstMonth }); }}
          onChanged={v => setChanged(prev => ({ ...prev, [v.id]: v }))} />
      )}
      {drivers}
    </>
  );
}

/** The Drivers card's text: with the Scenarios panel on, it points to it (Peter, 26 Nov 2026). */
export function driversText(scenariosLive: boolean): string {
  return scenariosLive
    ? 'Scenarios above change revenue, payroll and other costs by a percentage. Monthly drivers, such as growth per month or headcount, come in a later phase.'
    : 'No drivers yet. Drivers are the assumptions behind the plan, such as growth per month or headcount; they come in a later phase.';
}
