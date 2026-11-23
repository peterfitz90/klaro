import { Link } from 'react-router-dom';

/** 404. Inside an entity's shell it is a section; elsewhere a full page. */
export function NotFound({ inShell = false }: { inShell?: boolean }) {
  const body = (
    <>
      <h1 className="topbar-title" style={{ margin: inShell ? '0 0 12px' : '24px 0 12px' }}>Page not found</h1>
      <p className="msg msg-warn">There is no page at this address.</p>
      <p style={{ marginTop: 16 }}><Link to="/">Back to Klaro</Link></p>
    </>
  );
  return inShell ? <section>{body}</section> : <main className="page">{body}</main>;
}
