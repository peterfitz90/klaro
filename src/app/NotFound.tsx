import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <main className="page">
      <h1 className="topbar-title" style={{ margin: '24px 0 12px' }}>Page not found</h1>
      <p className="msg msg-warn">There is no page at this address.</p>
      <p style={{ marginTop: 16 }}><Link to="/">Back to Klaro</Link></p>
    </main>
  );
}
