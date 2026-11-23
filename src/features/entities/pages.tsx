// Pages outside a single entity: "/" (go to the right entity), the entity list and the create form.
import { useAuth } from '@clerk/clerk-react';
import { useId, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { SignOutButton } from '../../app/auth';
import { entityPath } from '../../app/shell/tasks';
import { userMessage } from '../../lib/errors';
import { useLoad } from '../../lib/useLoad';
import { createEntity, listEntities } from './api';
import { lastEntity } from './context';
import {
  CURRENCIES, defaultCurrency, entityMeta, JURISDICTIONS, MONTHS, validateCreateEntity, type FieldErrors, type Jurisdiction,
} from './model';

function OuterLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <header className="topbar">
        <Link to="/entities" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="topbar-title">Klaro</span> <span className="topbar-sub">by Ledgrly</span>
        </Link>
        <div className="topbar-right"><SignOutButton className="btn btn-s btn-sm" /></div>
      </header>
      <main className="page">
        <h1 className="topbar-title" style={{ margin: '24px 0 16px', fontSize: 24 }}>{title}</h1>
        {children}
      </main>
    </>
  );
}

function LoadError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div role="alert">
      <p className="msg msg-error">{message}</p>
      <button type="button" className="btn btn-s" style={{ marginTop: 12 }} onClick={retry}>Try again</button>
    </div>
  );
}

/** "/": the last entity opened (if still a member), else the first, else the create form. */
export function HomeRedirect() {
  const { userId } = useAuth();
  const load = useLoad(listEntities, [userId]);
  if (load.status === 'loading') return <main className="page"><p className="loading" role="status">Loading your entities…</p></main>;
  if (load.status === 'error') return <OuterLayout title="Your entities"><LoadError message={load.message} retry={load.reload} /></OuterLayout>;
  if (load.data.length === 0) return <Navigate to="/entities/new" replace />;
  const last = userId ? lastEntity(userId) : null;
  const target = load.data.find(e => e.id === last) ?? load.data[0];
  if (!target) return <Navigate to="/entities/new" replace />;
  return <Navigate to={entityPath(target.id)} replace />;
}

export function EntityListPage() {
  const load = useLoad(listEntities, []);
  return (
    <OuterLayout title="Your entities">
      {load.status === 'loading' && <p className="loading" role="status">Loading…</p>}
      {load.status === 'error' && <LoadError message={load.message} retry={load.reload} />}
      {load.status === 'ok' && (
        <>
          {load.data.length === 0 ? (
            <p className="msg msg-warn">You are not a member of any entity yet. Create one to start planning.</p>
          ) : (
            <div className="card" style={{ overflowX: 'auto' }}>
              <table className="gl-table">
                <caption className="sr-only">Entities you can open</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">Jurisdiction · currency</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
                <tbody>
                  {load.data.map(e => (
                    <tr key={e.id}>
                      <td>{e.name}</td>
                      <td className="mono">{entityMeta(e)}</td>
                      <td className="r"><Link to={entityPath(e.id)}>Open</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ marginTop: 16 }}><Link className="btn btn-p" to="/entities/new" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Create entity</Link></p>
        </>
      )}
    </OuterLayout>
  );
}

export function CreateEntityPage() {
  const navigate = useNavigate();
  const id = useId();
  const [name, setName] = useState('');
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('IE');
  const [currency, setCurrency] = useState<string>(defaultCurrency('IE'));
  const [currencyTouched, setCurrencyTouched] = useState(false);
  const [fiscalYearStart, setFiscalYearStart] = useState(1);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    const v = validateCreateEntity({ name, jurisdiction, currency, fiscalYearStart });
    if (!v.ok) { setErrors(v.errors); return; }
    setErrors({});
    setBusy(true);
    try {
      const newId = await createEntity(v.args);
      navigate(entityPath(newId), { replace: true });
    } catch (err) {
      setServerError(userMessage(err));
      setBusy(false);
    }
  };

  const field = (key: keyof FieldErrors) => (errors[key] ? { 'aria-invalid': true, 'aria-describedby': `${id}-${key}-err` } : {});

  return (
    <OuterLayout title="Create entity">
      <p className="f-hint" style={{ marginBottom: 16 }}>
        An entity is the business you plan for. You will be its owner. A default plan is created with it.
        It is separate from any company in Ledgrly.
      </p>
      <form className="card card-body" onSubmit={submit} noValidate>
        <div className="f-group">
          <label className="f-label" htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} className="f-input" value={name} maxLength={120} autoComplete="organization" required
            onChange={e => setName(e.target.value)} {...field('name')} />
          {errors.name && <span className="f-error" id={`${id}-name-err`}>{errors.name}</span>}
        </div>
        <div className="f-group">
          <label className="f-label" htmlFor={`${id}-jur`}>Jurisdiction</label>
          <select id={`${id}-jur`} className="f-input" value={jurisdiction} {...field('jurisdiction')}
            onChange={e => {
              const j = e.target.value as Jurisdiction;
              setJurisdiction(j);
              if (!currencyTouched) setCurrency(defaultCurrency(j));
            }}>
            {JURISDICTIONS.map(j => <option key={j} value={j}>{j === 'IE' ? 'Ireland (IE)' : 'United Kingdom (UK)'}</option>)}
          </select>
          {errors.jurisdiction && <span className="f-error" id={`${id}-jurisdiction-err`}>{errors.jurisdiction}</span>}
        </div>
        <div className="f-group">
          <label className="f-label" htmlFor={`${id}-cur`}>Currency</label>
          <select id={`${id}-cur`} className="f-input" value={currency} {...field('currency')}
            onChange={e => { setCurrency(e.target.value); setCurrencyTouched(true); }}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <span className="f-hint">All planning amounts for this entity are in this currency.</span>
          {errors.currency && <span className="f-error" id={`${id}-currency-err`}>{errors.currency}</span>}
        </div>
        <div className="f-group">
          <label className="f-label" htmlFor={`${id}-fy`}>Financial year starts in</label>
          <select id={`${id}-fy`} className="f-input" value={fiscalYearStart} {...field('fiscalYearStart')}
            onChange={e => setFiscalYearStart(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          {errors.fiscalYearStart && <span className="f-error" id={`${id}-fiscalYearStart-err`}>{errors.fiscalYearStart}</span>}
        </div>
        {serverError && <p className="msg msg-error" role="alert" style={{ marginBottom: 14 }}>{serverError}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-p" disabled={busy}>{busy ? 'Creating…' : 'Create entity'}</button>
          <Link className="btn btn-s" to="/entities" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Cancel</Link>
        </div>
      </form>
    </OuterLayout>
  );
}
