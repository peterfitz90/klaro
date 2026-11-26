// Map accounts, Phase 2: the balance accounts (from month-end balance imports). Each one is either
// Cash and bank (counted in the Cash balance and Runway) or left out (excluded). Suggestions come
// from the names, are labelled "Suggested", and are only used when the person says so; nothing is
// saved until Save. Mappings are never changed automatically. A mapping is per account code and
// source, so a code that also has P&L actuals shares its mapping with the P&L list above.
import { useId, useMemo, useState } from 'react';
import { suggestBalanceLine, toCents, type BalanceLine } from '../../engine';
import { dataChanged } from '../../lib/dataEvents';
import { callMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { useCurrentEntity } from '../entities/context';
import { balanceAccounts, setLineMap, type BalanceAccountRow } from './api';
import { drCr, monthLabel, plural } from './format';

const LABELS: Record<BalanceLine, string> = { cash_bank: 'Cash and bank', excluded: 'Not cash (left out)' };
const key = (a: BalanceAccountRow) => `${a.connection_id}|${a.account_code}`;

export function BalanceMapping() {
  const { entity, role } = useCurrentEntity();
  const canEdit = role === 'owner' || role === 'editor';
  const ids = useId();
  const load = useLoad(() => balanceAccounts(entity.id), [entity.id], err => callMessage(err, 'mapping'));
  const [edits, setEdits] = useState<Map<string, string | null>>(new Map());
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const rows = useMemo(() => (load.status === 'ok' ? load.data : []), [load]);

  if (load.status === 'loading') return <p className="loading" role="status">Loading the balance accounts…</p>;
  if (load.status === 'error') {
    return (
      <div role="alert">
        <p className="msg msg-error">The balance accounts could not be loaded. {load.message}</p>
        <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={load.reload}>Try again</button>
      </div>
    );
  }

  const effective = (a: BalanceAccountRow) => (edits.has(key(a)) ? edits.get(key(a)) ?? null : a.plan_line);
  const setLine = (a: BalanceAccountRow, line: string | null) => {
    setNotice(null);
    setEdits(prev => { const n = new Map(prev); if (line === a.plan_line) n.delete(key(a)); else n.set(key(a), line); return n; });
  };
  const suggestionFor = (a: BalanceAccountRow) => (a.plan_line === null && !edits.has(key(a)) ? suggestBalanceLine(a.account_name) : null);
  const withSuggestion = rows.filter(a => suggestionFor(a) !== null);
  const unmapped = rows.filter(a => a.plan_line === null).length;
  const cash = rows.filter(a => a.plan_line === 'cash_bank').length;
  const pending = new Map<string, { account_code: string; plan_line: string | null }[]>();
  for (const a of rows) {
    if (!edits.has(key(a))) continue;
    const line = edits.get(key(a)) ?? null;
    if (line === a.plan_line) continue;
    const list = pending.get(a.connection_id) ?? [];
    list.push({ account_code: a.account_code, plan_line: line });
    pending.set(a.connection_id, list);
  }
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
      if (done === 0) setNotice({ ok: false, text: msg });
      else {
        setEdits(new Map());
        setNotice({ ok: false, text: `The changes for ${done} of ${groups.length} sources were saved; the rest were not: ${msg} The list below shows what is saved now.` });
        load.reload();
        dataChanged(entity.id);
      }
    } finally { setSaving(false); }
  }

  return (
    <section className="card" aria-labelledby={`${ids}-t`} style={{ marginTop: 24 }} data-testid="balance-mapping">
      <div className="card-header"><h2 className="card-title" id={`${ids}-t`}>Balance accounts (month-end balances)</h2></div>
      <div className="card-body">
        {rows.length === 0 ? (
          <p className="f-hint">No month-end balances imported yet. On Import, choose "Month-end balances" to add them; then map the bank accounts here to Cash and bank.</p>
        ) : (
          <>
            <p className={`msg ${unmapped === 0 ? 'msg-ok' : 'msg-warn'}`} data-testid="balance-status">
              {unmapped === 0
                ? <>All {plural(rows.length, 'balance account')} are mapped; {plural(cash, 'account')} on Cash and bank.</>
                : <>{unmapped.toLocaleString('en-IE')} of {plural(rows.length, 'balance account')} unmapped. The Cash balance is marked incomplete until they are mapped.</>}
              {cash === 0 && ' No account is on Cash and bank yet, so the Cash balance and Runway show "—".'}
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
                  <button type="button" className="btn btn-s btn-sm" disabled={saving} onClick={() => {
                    setNotice(null);
                    setEdits(prev => { const n = new Map(prev); for (const a of withSuggestion) n.set(key(a), suggestionFor(a)); return n; });
                  }}>Use all {plural(withSuggestion.length, 'suggestion')}</button>
                )}
              </div>
            ) : (
              <p className="msg msg-warn" style={{ marginTop: 12 }}>You can see the mapping. Changing it needs editor or owner access to {entity.name}.</p>
            )}
            {canEdit && withSuggestion.length > 0 && <p className="f-hint" style={{ marginTop: 6 }}>Suggestions come from the account names. Using one only fills in the choice; nothing is saved until you press Save.</p>}
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table className="gl-table map-table" aria-label="Balance accounts and their plan lines">
                <thead><tr><th scope="col">Account</th><th scope="col" className="r">Months</th><th scope="col" className="r">Latest balance</th><th scope="col">Plan line</th></tr></thead>
                <tbody>
                  {rows.map(a => {
                    const line = effective(a);
                    const sug = suggestionFor(a);
                    let bal: string;
                    try { bal = drCr(toCents(a.last_balance), entity.currency); } catch { bal = String(a.last_balance); }
                    return (
                      <tr key={key(a)} className={line === null ? 'row-unmapped' : undefined}>
                        <td><span className="mono">{a.account_code}</span> {a.account_name ?? <span className="f-hint">(no name)</span>}</td>
                        <td className="r mono" data-label="Months">{a.months}</td>
                        <td className="r mono" data-label="Latest balance" title={a.last_month ? `At the end of ${monthLabel(a.last_month)}` : undefined}>{bal}</td>
                        <td>
                          <label className="sr-only" htmlFor={`${ids}-${key(a)}`}>Plan line for balance account {a.account_code}</label>
                          <select id={`${ids}-${key(a)}`} className="f-input f-input-sm" value={line ?? ''} disabled={!canEdit || saving}
                            onChange={e => setLine(a, e.target.value === '' ? null : e.target.value)}>
                            <option value="">Unmapped</option>
                            <option value="cash_bank">{LABELS.cash_bank}</option>
                            <option value="excluded">{LABELS.excluded}</option>
                            {line && line !== 'cash_bank' && line !== 'excluded' && <option value={line}>{line} (a P&amp;L line)</option>}
                          </select>
                          {edits.has(key(a)) && <span className="f-hint" style={{ marginLeft: 6 }}>changed</span>}
                          {sug && canEdit && (
                            <div className="f-hint" style={{ marginTop: 4 }}>
                              Suggested: {LABELS[sug]}{' '}
                              <button type="button" className="btn btn-s btn-xs" disabled={saving} onClick={() => setLine(a, sug)} aria-label={`Use the suggestion ${LABELS[sug]} for ${a.account_code}`}>Use</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
