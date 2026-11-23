// Connect: the three ways actuals will arrive. None is wired in Phase 0, and the page says so.
import { useCurrentEntity } from '../entities/context';

const SOURCES = [
  { key: 'accounting_package', title: 'Accounting package', text: 'Connect the accounting software the books are kept in. Monthly balances per account are synced in.' },
  { key: 'mcp', title: 'MCP-style connection', text: 'Connect a data source that speaks the Model Context Protocol, such as another finance tool.' },
  { key: 'csv', title: 'CSV import', text: 'Upload a trial balance or monthly balances per account as a CSV file.' },
] as const;

export function ConnectPage() {
  const { entity, role } = useCurrentEntity();
  return (
    <>
      <p className="msg msg-warn" style={{ marginBottom: 16 }}>
        No connection is available yet. This is where {entity.name}'s actuals will come from; the first connectors arrive in Phase 1.
        {role !== 'owner' && ' Only an owner of this entity will be able to add a connection.'}
      </p>
      <div className="grid-3">
        {SOURCES.map(s => (
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
