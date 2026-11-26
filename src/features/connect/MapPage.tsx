// Map accounts (Phase 1, step 1C): every imported account gets a plan line. Unmapped accounts come
// first; "Mapping complete" shows only once the whole list is read and none is unmapped; the
// excluded count and net total are always on screen; suggestions are shown but only used when the
// user says so, and nothing is saved until Save (docs/ui-rules.md sections 1, 2 and 6).
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { entityPath } from '../../app/shell/tasks';
import { suggestLine } from '../../engine';
import { callMessage } from '../../lib/errors';
import { dataChanged } from '../../lib/dataEvents';
import { useLoad } from '../../lib/useLoad';
import { useCurrentEntity } from '../entities/context';
import { accountMap, listConnections, listPlanLineDefs, setLineMap } from './api';
import { BalanceMapping } from './BalanceMapping';
import { ConnectTabs } from './ConnectPage';
import { drCr, monthLabel, plural } from './format';
import { editsByConnection, summarise, toAccounts, type Account } from './mapping';

const PAGE = 200;
type Filter = 'all' | 'unmapped' | 'excluded';

export function MapPage() {
  const { entity, role } = useCurrentEntity();
  const canEdit = role === 'owner' || role === 'editor';
  const ids = useId();
  const load = useLoad(async () => {
    const [defs, rows, connections] = await Promise.all([listPlanLineDefs(), accountMap(entity.id), listConnections(entity.id)]);
    return { defs, accounts: toAccounts(rows), connections };
  }, [entity.id], err => callMessage(err, 'mapping'));

  const [edits, setEdits] = useState<Map<string, string | null>>(new Map());
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const data = load.status === 'ok' ? load.data : null;
  // Cash and bank is offered only for balance accounts (the section below), not for P&L accounts.
  const lineOptions = useMemo(() => (data ? data.defs.filter(d => d.mappable && d.kind !== 'balance') : []), [data]);
  const labelOf = useMemo(() => new Map((data?.defs ?? []).map(d => [d.key, d.label])), [data]);
  const summary = useMemo(() => (data ? summarise(data.accounts) : null), [data]);

  if (load.status === 'loading') return <><ConnectTabs /><p className="loading" role="status">Loading every account…</p></>;
  if (load.status === 'error' || !data || !summary) {
    return (
      <>
        <ConnectTabs />
        <div role="alert">
          <p className="msg msg-error">The accounts could not be loaded. {load.status === 'error' ? load.message : ''}</p>
          <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={load.reload}>Try again</button>
        </div>
      </>
    );
  }

  const effective = (a: Account) => (edits.has(a.key) ? edits.get(a.key) ?? null : a.plan_line);
  const setLine = (a: Account, line: string | null) => {
    setNotice(null);
    setEdits(prev => {
      const next = new Map(prev);
      if (line === a.plan_line) next.delete(a.key); else next.set(a.key, line);
      return next;
    });
  };
  const suggestionFor = (a: Account) => (a.plan_line === null && !edits.has(a.key) ? suggestLine(a.account_name) : null);
  const withSuggestion = data.accounts.filter(a => suggestionFor(a) !== null);
  const useAll = () => {
    setNotice(null);
    setEdits(prev => {
      const next = new Map(prev);
      for (const a of withSuggestion) next.set(a.key, suggestionFor(a));
      return next;
    });
  };
  const pending = editsByConnection(data.accounts, edits);
  const pendingCount = [...pending.values()].reduce((n, l) => n + l.length, 0);

  async function save() {
    setSaving(true); setNotice(null);
    const groups = [...pending];
    let done = 0;
    try {
      for (const [connectionId, entries] of groups) { await setLineMap(connectionId, entries); done++; }
      setEdits(new Map());
      setNotice({ ok: true, text: `Saved ${plural(pendingCount, 'change')}.` });
      load.reload();
      dataChanged(entity.id);
    } catch (err) {
      const msg = callMessage(err, 'mapping');
      if (done === 0) {
        setNotice({ ok: false, text: msg });
      } else {
        // Each source is saved in its own transaction: say exactly what happened, then show the truth.
        setEdits(new Map());
        setNotice({ ok: false, text: `The changes for ${done} of ${groups.length} sources were saved; the rest were not: ${msg} The list below shows what is saved now.` });
        load.reload();
        dataChanged(entity.id);
      }
    } finally {
      setSaving(false);
    }
  }

  const q = query.trim().toLowerCase();
  const visible = data.accounts.filter(a => {
    const line = effective(a);
    if (filter === 'unmapped' && !(a.months > 0 && line === null)) return false;
    if (filter === 'excluded' && line !== 'excluded') return false;
    return !q || a.account_code.toLowerCase().includes(q) || (a.account_name ?? '').toLowerCase().includes(q);
  });
  const manySources = data.connections.length > 1;
  const sourceName = (id: string) => `Source ${data.connections.findIndex(c => c.id === id) + 1}`;

  return (
    <>
      <ConnectTabs />
      <section className="card" aria-labelledby={`${ids}-sum`} style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 className="card-title" id={`${ids}-sum`}>Mapping</h2></div>
        <div className="card-body">
          {summary.accounts === 0 ? (
            <p className="msg msg-warn" data-testid="mapping-status">
              No accounts yet. <Link to={entityPath(entity.id, 'connect')}>Import a file</Link> first.
            </p>
          ) : summary.complete ? (
            <p className="msg msg-ok" data-testid="mapping-status"><span aria-hidden="true">✓ </span>Mapping complete: all {plural(summary.accounts, 'account')} with actuals are mapped.</p>
          ) : (
            <p className="msg msg-warn" data-testid="mapping-status">
              Mapping not complete: {summary.unmapped.toLocaleString('en-IE')} of {plural(summary.accounts, 'account')} unmapped.
              Unmapped amounts show on the Unmapped line and the profit figures are incomplete until they are mapped.
            </p>
          )}
          <p style={{ marginTop: 10 }} data-testid="excluded-summary">
            <strong>Not in the P&amp;L (excluded):</strong> {plural(summary.excludedCount, 'account')}, net total {drCr(summary.excludedCents, entity.currency)}.
            <span className="f-hint"> These stay stored; they are only left out of the P&amp;L lines.</span>
          </p>
          {pendingCount > 0 && <p className="msg msg-warn" style={{ marginTop: 10 }}>{plural(pendingCount, 'unsaved change')}. The status above is what is saved.</p>}
          {notice && <p className={`msg ${notice.ok ? 'msg-ok' : 'msg-error'}`} role={notice.ok ? 'status' : 'alert'} style={{ marginTop: 10 }}>{notice.text}</p>}
          {canEdit ? (
            <div className="row-gap" style={{ marginTop: 12 }}>
              <button type="button" className="btn btn-p" disabled={pendingCount === 0 || saving} onClick={save}>
                {saving ? 'Saving…' : pendingCount ? `Save ${plural(pendingCount, 'change')}` : 'Save'}
              </button>
              <button type="button" className="btn btn-s btn-sm" disabled={pendingCount === 0 || saving} onClick={() => { setEdits(new Map()); setNotice(null); }}>Discard changes</button>
              {withSuggestion.length > 0 && (
                <button type="button" className="btn btn-s btn-sm" disabled={saving} onClick={useAll}>
                  Use all {plural(withSuggestion.length, 'suggestion')}
                </button>
              )}
            </div>
          ) : (
            <p className="msg msg-warn" style={{ marginTop: 12 }}>You can see the mapping. Changing it needs editor or owner access to {entity.name}.</p>
          )}
          {canEdit && withSuggestion.length > 0 && <p className="f-hint" style={{ marginTop: 6 }}>Suggestions come from the account names. Using one only fills in the choice; nothing is saved until you press Save.</p>}
        </div>
      </section>

      <div className="row-gap" style={{ marginBottom: 10 }}>
        <div role="group" aria-label="Show" className="seg">
          {(['all', 'unmapped', 'excluded'] as const).map(f => (
            <button key={f} type="button" className={`seg-btn${filter === f ? ' active' : ''}`} aria-pressed={filter === f} onClick={() => { setFilter(f); setShown(PAGE); }}>
              {f === 'all' ? 'All' : f === 'unmapped' ? 'Unmapped' : 'Excluded'}
            </button>
          ))}
        </div>
        <label className="sr-only" htmlFor={`${ids}-q`}>Find an account</label>
        <input id={`${ids}-q`} className="f-input" style={{ flex: '1 1 200px', maxWidth: 320 }} placeholder="Find by code or name" value={query} onChange={e => { setQuery(e.target.value); setShown(PAGE); }} />
      </div>

      {visible.length === 0 ? <p className="f-hint">No accounts match.</p> : (
        <div className="table-wrap">
          <table className="gl-table map-table" aria-label="Accounts and their plan lines">
            <thead>
              <tr>
                <th scope="col">Account</th>
                {manySources && <th scope="col">Source</th>}
                <th scope="col" className="r">Months</th>
                <th scope="col" className="r">Net total</th>
                <th scope="col">Plan line</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, shown).map(a => {
                const line = effective(a);
                const sug = suggestionFor(a);
                const changed = edits.has(a.key);
                return (
                  <tr key={a.key} className={line === null && a.months > 0 ? 'row-unmapped' : undefined}>
                    <td>
                      <span className="mono">{a.account_code}</span> {a.account_name ?? <span className="f-hint">(no name)</span>}
                      {a.months === 0 && <div className="f-hint">No actuals now; the mapping is kept.</div>}
                    </td>
                    {manySources && <td data-label="Source">{sourceName(a.connection_id)}</td>}
                    <td className="r mono" data-label="Months" title={a.first_month && a.last_month ? `${monthLabel(a.first_month)} to ${monthLabel(a.last_month)}` : undefined}>{a.months}</td>
                    <td className="r mono" data-label="Net total">{drCr(a.cents, entity.currency)}</td>
                    <td>
                      <label className="sr-only" htmlFor={`${ids}-${a.key}`}>Plan line for {a.account_code}</label>
                      <select id={`${ids}-${a.key}`} className="f-input f-input-sm" value={line ?? ''} disabled={!canEdit || saving}
                        onChange={e => setLine(a, e.target.value === '' ? null : e.target.value)}>
                        <option value="">Unmapped</option>
                        {lineOptions.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
                        {line === 'cash_bank' && <option value="cash_bank">Cash and bank (a balance line)</option>}
                      </select>
                      {changed && <span className="f-hint" style={{ marginLeft: 6 }}>changed</span>}
                      {sug && canEdit && (
                        <div className="f-hint" style={{ marginTop: 4 }}>
                          Suggested: {labelOf.get(sug) ?? sug}{' '}
                          <button type="button" className="btn btn-s btn-xs" disabled={saving} onClick={() => setLine(a, sug)} aria-label={`Use the suggestion ${labelOf.get(sug) ?? sug} for ${a.account_code}`}>Use</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {visible.length > shown && (
        <p style={{ marginTop: 10 }}>
          <span className="f-hint">Showing {shown.toLocaleString('en-IE')} of {visible.length.toLocaleString('en-IE')}. </span>
          <button type="button" className="btn btn-s btn-sm" onClick={() => setShown(s => s + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more</button>
        </p>
      )}
      <BalanceMapping />
    </>
  );
}
