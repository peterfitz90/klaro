// One budget version (Phase 1, step 1D): its lines month by month, in display sign (revenue positive),
// editable by editors and owners while it is unlocked. Typing an amount stores display sign × typed
// and marks the line as edited by hand (origin "manual"). Editors and owners lock; only owners unlock
// (the database enforces both). A locked version cannot be edited or rebuilt.
import { useId, useMemo, useState } from 'react';
import { addMonths, fiscalYearStart, storedFromTyped, toCents, type Period } from '../../engine';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import type { Entity, Role } from '../entities/model';
import type { PlanLineDef } from '../connect/api';
import { dateTime, monthLabel, plainAmount, plural } from '../connect/format';
import { budgetLines, editLine, setLocked, type BudgetLine, type Plan, type Version } from './api';

export interface BudgetViewProps {
  entity: Entity;
  plan: Plan;
  defs: PlanLineDef[];
  version: Version;
  role: Role;
  onRebuild: (firstMonth: Period | null) => void;
  onChanged: (v: Version) => void;
}

export function BudgetView({ entity, plan, defs, version, role, onRebuild, onChanged }: BudgetViewProps) {
  const ids = useId();
  const canEdit = role === 'owner' || role === 'editor';
  const locked = version.locked_at !== null;
  const load = useLoad(() => budgetLines(version.id), [version.id], err => callMessage(err, 'budget'));
  const [edits, setEdits] = useState<Map<string, string>>(new Map());
  const [year, setYear] = useState<Period | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  const data = load.status === 'ok' ? load.data : null;
  const years = useMemo(() => [...new Set((data ?? []).map(l => fiscalYearStart(l.period, plan.fiscal_year_start)))].sort(), [data, plan.fiscal_year_start]);
  const shownYear = year && years.includes(year) ? year : years[years.length - 1] ?? null;
  const months = shownYear ? Array.from({ length: 12 }, (_, k) => addMonths(shownYear, k)) : [];
  const cells = useMemo(() => new Map((data ?? []).map(l => [`${l.plan_line}|${l.period}`, l])), [data]);
  const sign = (key: string) => (defs.find(d => d.key === key)?.display_sign ?? 1);
  const budgetable = defs.filter(d => d.kind === 'income' || d.kind === 'cost');
  const calculated = defs.filter(d => d.kind === 'calculated');

  /** Stored cents of a cell, with a valid unsaved edit taken into account. */
  const storedCents = (l: BudgetLine | undefined): bigint | null => {
    if (!l || l.amount === null) return null;
    const typed = edits.get(l.id);
    if (typed !== undefined) {
      const r = storedFromTyped(typed, sign(l.plan_line) as 1 | -1, entity.currency);
      if ('amount' in r) return toCents(r.amount);
    }
    return toCents(l.amount);
  };

  async function save() {
    if (!data) return;
    const list: { id: string; label: string; amount: string }[] = [];
    const bad: string[] = [];
    for (const [id, text] of edits) {
      const l = data.find(x => x.id === id);
      if (!l) continue;
      const def = defs.find(d => d.key === l.plan_line);
      const r = storedFromTyped(text, sign(l.plan_line) as 1 | -1, entity.currency);
      if ('problem' in r) bad.push(`${def?.label ?? l.plan_line}, ${monthLabel(l.period)}: ${r.problem}`);
      else list.push({ id, label: `${def?.label ?? l.plan_line}, ${monthLabel(l.period)}`, amount: r.amount });
    }
    setProblems(bad);
    if (bad.length) return;
    setBusy(true); setNotice(null);
    const saved: string[] = [];
    try {
      for (const x of list) { await editLine(x.id, x.amount); saved.push(x.id); }
      setEdits(new Map());
      setNotice({ ok: true, text: `Saved ${plural(saved.length, 'change')}.` });
      load.reload();
    } catch (err) {
      const msg = callMessage(err, 'budget');
      if (saved.length === 0) {
        setNotice({ ok: false, text: msg });
      } else {
        // Each line is saved on its own. Keep the lines that did not save as unsaved edits, so one
        // click retries them, and show what is saved now.
        const left = list.length - saved.length;
        setEdits(prev => { const n = new Map(prev); for (const id of saved) n.delete(id); return n; });
        setNotice({ ok: false, text: `${plural(saved.length, 'change')} of ${list.length} ${saved.length === 1 ? 'was' : 'were'} saved; ${left === 1 ? 'the other was' : `the other ${left} were`} not. ${left === 1 ? 'It is' : 'They are'} still here as unsaved: press Save to try again. ${msg}` });
        load.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  async function lock(next: boolean) {
    setBusy(true); setNotice(null);
    try { onChanged(await setLocked(version.id, next)); } catch (err) {
      const code = (err as { code?: unknown }).code;
      setNotice({ ok: false, text: code === 'PT403' ? 'Only an owner can unlock a version.' : callMessage(err, 'budget') });
    } finally { setBusy(false); }
  }

  const firstMonth = data && data.length ? data.reduce((m, l) => (l.period < m ? l.period : m), data[0]?.period ?? '') : null;

  return (
    <section className="card" aria-labelledby={`${ids}-t`} style={{ marginBottom: 16 }}>
      <div className="card-header"><h2 className="card-title" id={`${ids}-t`}>{version.name}</h2>
        {locked ? <span className="pill pill-locked">Locked</span> : <span className="pill pill-open">Open</span>}
      </div>
      <div className="card-body">
        {locked && (
          <p className="msg msg-warn" style={{ marginBottom: 10 }}>
            Locked {dateTime(version.locked_at ?? '')}. It cannot be edited or rebuilt. {role === 'owner' ? 'You can unlock it.' : 'Only an owner can unlock it.'}
          </p>
        )}
        {canEdit && (
          <div className="row-gap" style={{ marginBottom: 12 }}>
            {!locked && <button type="button" className="btn btn-s btn-sm" disabled={busy || edits.size > 0} onClick={() => lock(true)}>Lock this budget</button>}
            {locked && role === 'owner' && <button type="button" className="btn btn-s btn-sm" disabled={busy} onClick={() => lock(false)}>Unlock</button>}
            <button type="button" className="btn btn-s btn-sm" disabled={busy || edits.size > 0} onClick={() => onRebuild(firstMonth)}>Rebuild from actuals…</button>
            {!locked && edits.size > 0 && <span className="f-hint">Save or discard your changes first.</span>}
          </div>
        )}
        {notice && <p className={`msg ${notice.ok ? 'msg-ok' : 'msg-error'}`} role={notice.ok ? 'status' : 'alert'} style={{ marginBottom: 10 }}>{notice.text}</p>}
        {problems.length > 0 && (
          <div className="msg msg-error" role="alert" style={{ marginBottom: 10 }}>
            Nothing was saved. Fix these first:<ul style={{ margin: '6px 0 0 18px' }}>{problems.map(p => <li key={p}>{p}</li>)}</ul>
          </div>
        )}

        {load.status === 'loading' && <p className="loading" role="status">Loading the budget…</p>}
        {load.status === 'error' && (
          <div role="alert"><p className="msg msg-error">The budget could not be loaded. {load.message}</p>
            <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={load.reload}>Try again</button></div>
        )}
        {data && data.length === 0 && <p className="f-hint">This budget has no lines yet. Rebuild it from actuals.</p>}
        {data && data.length > 0 && shownYear && (
          <>
            <div className="row-gap" style={{ marginBottom: 8 }}>
              {years.length > 1 && (
                <>
                  <label className="f-label" htmlFor={`${ids}-y`}>Year</label>
                  <select id={`${ids}-y`} className="f-input f-input-sm" style={{ width: 'auto' }} value={shownYear} onChange={e => setYear(e.target.value)}>
                    {years.map(y => <option key={y} value={y}>{monthLabel(y)} to {monthLabel(addMonths(y, 11))}</option>)}
                  </select>
                </>
              )}
              <span className="f-hint">Amounts in {entity.currency}; revenue and profit as positive numbers. <span className="manual-mark" aria-hidden="true">✎</span> edited by hand.</span>
            </div>
            <div className="table-wrap">
              <table className="gl-table budget-grid" aria-label={`${version.name}, ${monthLabel(shownYear)} to ${monthLabel(addMonths(shownYear, 11))}`}>
                <thead>
                  <tr><th scope="col">Line</th>{months.map(m => <th scope="col" key={m} className="r">{monthLabel(m)}</th>)}<th scope="col" className="r">Year</th></tr>
                </thead>
                <tbody>
                  {budgetable.map(d => {
                    const row = months.map(m => cells.get(`${d.key}|${m}`));
                    const total = row.reduce<bigint | null>((s, l) => { const c = storedCents(l); return s === null || c === null ? null : s + c; }, 0n);
                    return (
                      <tr key={d.key}>
                        <th scope="row" style={{ fontWeight: 500 }}>{d.label}</th>
                        {row.map((l, k) => {
                          const m = months[k] ?? '';
                          if (!l || l.amount === null) return <td key={m} className="r mono">—</td>;
                          const shown = plainAmount(toCents(l.amount) * BigInt(d.display_sign));
                          const typed = edits.get(l.id);
                          const manual = l.origin === 'manual';
                          return (
                            <td key={m} className={`r${manual ? ' cell-manual' : ''}`}>
                              {canEdit && !locked ? (
                                <>
                                  <label className="sr-only" htmlFor={`${ids}-${l.id}`}>{d.label}, {monthLabel(m)}</label>
                                  <input id={`${ids}-${l.id}`} className={`f-input f-input-sm cell-input${typed !== undefined ? ' cell-changed' : ''}`} inputMode="decimal"
                                    value={typed ?? shown} disabled={busy}
                                    onChange={e => { const v = e.target.value; setNotice(null); setEdits(prev => { const n = new Map(prev); if (v === shown) n.delete(l.id); else n.set(l.id, v); return n; }); }} />
                                </>
                              ) : <span className="mono">{shown}</span>}
                              {manual && <span className="manual-mark" title="Edited by hand"> ✎<span className="sr-only">edited by hand</span></span>}
                            </td>
                          );
                        })}
                        <td className="r mono">{total === null ? '—' : plainAmount(total * BigInt(d.display_sign))}</td>
                      </tr>
                    );
                  })}
                  {calculated.map(c => {
                    const parts = budgetable.filter(d => d.sort_order < c.sort_order);
                    const monthTotal = (m: Period) => parts.reduce<bigint | null>((s, d) => { const v = storedCents(cells.get(`${d.key}|${m}`)); return s === null || v === null ? null : s + v; }, 0n);
                    const vals = months.map(monthTotal);
                    const year = vals.reduce<bigint | null>((s, v) => (s === null || v === null ? null : s + v), 0n);
                    const disp = (v: bigint | null) => (v === null ? '—' : plainAmount(v * BigInt(c.display_sign)));
                    return (
                      <tr key={c.key} className="row-total">
                        <th scope="row">{c.label}</th>
                        {vals.map((v, k) => <td key={months[k]} className="r mono">{disp(v)}</td>)}
                        <td className="r mono">{disp(year)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {canEdit && !locked && (
              <div className="row-gap" style={{ marginTop: 10 }}>
                <button type="button" className="btn btn-p" disabled={busy || edits.size === 0} onClick={save}>
                  {busy ? 'Saving…' : edits.size ? `Save ${plural(edits.size, 'change')}` : 'Save'}
                </button>
                <button type="button" className="btn btn-s btn-sm" disabled={busy || edits.size === 0} onClick={() => { setEdits(new Map()); setProblems([]); setNotice(null); }}>Discard changes</button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
