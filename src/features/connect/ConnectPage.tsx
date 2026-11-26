// Connect: where the actuals come from. Phase 1 adds CSV import (step 1B) and the account mapping
// (step 1C, ./MapPage). Owners add the CSV connection; editors and owners import; viewers see the
// status only. Every load fails closed: an error is shown as an error, never as "no data".
import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { entityPath } from '../../app/shell/tasks';
import { userMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { useCurrentEntity } from '../entities/context';
import { addCsvConnection, balanceAccounts, fiscalYearStartMonth, importedMonths, listConnections, recentImports, type Connection } from './api';
import { dateTime, monthLabel, monthsSummary, plural } from './format';
import { ImportWizard } from './ImportWizard';

const OTHER_SOURCES = [
  { key: 'accounting_package', title: 'Accounting package', text: 'Connect the accounting software the books are kept in. Monthly balances per account are synced in.' },
  { key: 'mcp', title: 'MCP-style connection', text: 'Connect a data source that speaks the Model Context Protocol, such as another finance tool.' },
] as const;

/** Import and Map accounts, the two parts of Connect. */
export function ConnectTabs() {
  const { entity } = useCurrentEntity();
  const base = entityPath(entity.id, 'connect');
  return (
    <nav className="subnav" aria-label="Connect">
      <NavLink end to={base} className={({ isActive }) => `subnav-item${isActive ? ' active' : ''}`}>Import</NavLink>
      <NavLink to={`${base}/map`} className={({ isActive }) => `subnav-item${isActive ? ' active' : ''}`}>Map accounts</NavLink>
    </nav>
  );
}

export function ConnectPage() {
  const { entity, role } = useCurrentEntity();
  const load = useLoad(async () => {
    const [connections, fyStart] = await Promise.all([listConnections(entity.id), fiscalYearStartMonth(entity.id)]);
    return { csv: connections.filter(c => c.source_type === 'csv'), fyStart };
  }, [entity.id]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function add() {
    setAdding(true); setAddError(null);
    try { await addCsvConnection(entity.id); load.reload(); } catch (err) { setAddError(userMessage(err)); } finally { setAdding(false); }
  }

  return (
    <>
      <ConnectTabs />
      <section className="card" aria-labelledby="csv-title" style={{ marginBottom: 16 }}>
        <div className="card-header"><h2 className="card-title" id="csv-title">CSV import</h2></div>
        <div className="card-body">
          {load.status === 'loading' && <p className="loading" role="status">Loading connections…</p>}
          {load.status === 'error' && (
            <div role="alert">
              <p className="msg msg-error">The connections could not be loaded: {load.message}</p>
              <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={load.reload}>Try again</button>
            </div>
          )}
          {load.status === 'ok' && load.data.csv.length === 0 && (
            <div>
              <p className="f-hint" style={{ marginBottom: 10 }}>
                Upload a trial balance or monthly balances per account as a CSV file. First an owner adds a CSV connection for {entity.name}.
              </p>
              {role === 'owner'
                ? <button type="button" className="btn btn-p" disabled={adding} onClick={add}>{adding ? 'Adding…' : 'Add a CSV connection'}</button>
                : <p className="msg msg-warn">Only an owner of {entity.name} can add a CSV connection. Ask an owner to add one.</p>}
              {addError && <p className="msg msg-error" role="alert" style={{ marginTop: 8 }}>{addError}</p>}
            </div>
          )}
          {load.status === 'ok' && load.data.csv[0] && (
            <CsvConnection key={load.data.csv[0].id} connection={load.data.csv[0]} fyStart={load.data.fyStart} />
          )}
        </div>
      </section>
      <div className="grid-3">
        {OTHER_SOURCES.map(s => (
          <section className="card" key={s.key} aria-labelledby={`src-${s.key}`}>
            <div className="card-header"><h2 className="card-title" id={`src-${s.key}`}>{s.title}</h2></div>
            <div className="card-body">
              <p className="f-hint" style={{ marginBottom: 12 }}>{s.text}</p>
              <button type="button" className="btn btn-s btn-sm" disabled aria-describedby={`src-${s.key}-ns`}>Connect</button>
              <span className="f-hint" id={`src-${s.key}-ns`} style={{ marginLeft: 8 }}>Not available yet</span>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/** One CSV connection: its status and recent imports (reloaded after each import), and the import. */
function CsvConnection({ connection, fyStart }: { connection: Connection; fyStart: number }) {
  const { entity, role } = useCurrentEntity();
  const canImport = role === 'owner' || role === 'editor';
  const status = useLoad(async () => {
    const [connections, runs, months, balanceMonths, balAccounts] = await Promise.all([
      listConnections(entity.id), recentImports(connection.id), importedMonths(connection.id, 'actuals'), importedMonths(connection.id, 'balances'), balanceAccounts(entity.id),
    ]);
    const now = connections.find(c => c.id === connection.id);
    if (!now) throw new Error('This connection is no longer visible to you.');
    const mine = balAccounts.filter(a => a.connection_id === connection.id);
    const cashCodes = new Set(mine.filter(a => a.plan_line === 'cash_bank').map(a => a.account_code));
    const balancesThrough = mine.reduce<string | null>((m, a) => (a.last_month && (!m || a.last_month > m) ? a.last_month : m), null);
    return { now, runs, months, balanceMonths, cashCodes, balancesThrough };
  }, [entity.id, connection.id]);

  return (
    <div>
      <div aria-live="polite">
        {status.status === 'loading' && <p className="loading" role="status">Loading the import status…</p>}
        {status.status === 'error' && (
          <div role="alert" style={{ marginBottom: 12 }}>
            <p className="msg msg-error">The import status could not be loaded: {status.message}</p>
            <button type="button" className="btn btn-s btn-sm" style={{ marginTop: 8 }} onClick={status.reload}>Try again</button>
          </div>
        )}
        {status.status === 'ok' && (
          <p className="f-hint" style={{ marginBottom: 12 }}>
            {status.data.now.actuals_through
              ? <>Actuals through <strong>{monthLabel(status.data.now.actuals_through)}</strong>, last synced {status.data.now.last_synced_at ? dateTime(status.data.now.last_synced_at) : 'never'}.</>
              : <>No actuals imported yet.</>}
            {' '}{status.data.balancesThrough
              ? <>Balances through <strong>{monthLabel(status.data.balancesThrough)}</strong>.</>
              : <>No month-end balances imported yet.</>}
            {status.data.now.status === 'disabled' && <> This connection is disabled.</>}
          </p>
        )}
      </div>
      {canImport ? (
        <ImportWizard
          entityId={entity.id}
          currency={entity.currency}
          connection={connection}
          fiscalYearStartMonth={fyStart}
          importedMonths={status.status === 'ok' ? status.data.months : null}
          importedBalanceMonths={status.status === 'ok' ? status.data.balanceMonths : null}
          cashCodes={status.status === 'ok' ? status.data.cashCodes : null}
          mapPath={`${entityPath(entity.id, 'connect')}/map`}
          onAttempted={status.reload}
        />
      ) : (
        <p className="msg msg-warn">You can see the import status. Importing needs editor or owner access to {entity.name}.</p>
      )}
      {status.status === 'ok' && (
        <div style={{ marginTop: 16 }}>
          <h3 className="step-title">Recent imports</h3>
          {status.data.runs.length === 0 ? <p className="f-hint">None yet.</p> : (
            <div className="table-wrap">
              <table className="gl-table" aria-label="Recent imports (latest 10)">
                <thead><tr><th scope="col">When</th><th scope="col">File</th><th scope="col">Type</th><th scope="col">Months replaced</th><th scope="col" className="r">Removed</th><th scope="col" className="r">Added</th></tr></thead>
                <tbody>
                  {status.data.runs.map(r => (
                    <tr key={r.id}>
                      <td>{dateTime(r.created_at)}</td><td>{r.source_name}</td><td>{r.kind === 'balances' ? 'Balances' : 'P&L'}</td><td>{monthsSummary(r.months_replaced)}</td>
                      <td className="r mono">{r.rows_removed.toLocaleString('en-IE')}</td><td className="r mono">{r.rows_added.toLocaleString('en-IE')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {status.data.runs.length === 10 && <p className="f-hint" style={{ marginTop: 6 }}>Showing the latest 10 imports.</p>}
          {status.data.runs.length > 0 && (
            <p className="f-hint" style={{ marginTop: 6 }}>
              {plural(status.data.months.size, 'month')} of P&amp;L imported in all{status.data.balanceMonths.size > 0 && `; ${plural(status.data.balanceMonths.size, 'month-end')} of balances`}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
