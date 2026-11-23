import { Route, Routes } from 'react-router-dom';
import { NotFound } from './NotFound';

// B1 scaffold only: sign-in, entities and the shell arrive in B4.
export function App() {
  return (
    <Routes>
      <Route
        path="/"
        element={
          <main className="page">
            <h1 className="topbar-title" style={{ margin: '24px 0 4px' }}>Klaro</h1>
            <p className="topbar-sub">by Ledgrly</p>
          </main>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
