// Routes. Signed-out: /sign-in and /sign-up (Klaro's own, embedded Clerk). Everything else needs a
// signed-in user (RequireAuth). The current entity lives in the URL: /e/:entityId/<task>.
import { Navigate, Route, Routes } from 'react-router-dom';
import { CashPage } from '../features/cash/CashPage';
import { ComparePage } from '../features/compare/ComparePage';
import { ConnectPage } from '../features/connect/ConnectPage';
import { MapPage } from '../features/connect/MapPage';
import { CreateEntityPage, EntityListPage, HomeRedirect } from '../features/entities/pages';
import { PlanPage } from '../features/plan/PlanPage';
import { ReportPage } from '../features/report/ReportPage';
import { AuthProvider, RequireAuth, SignInPage, SignUpPage } from './auth';
import { NotFound } from './NotFound';
import { EntityLayout } from './shell/EntityLayout';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/sign-in/*" element={<SignInPage />} />
        <Route path="/sign-up/*" element={<SignUpPage />} />
        <Route path="/" element={<RequireAuth><HomeRedirect /></RequireAuth>} />
        <Route path="/entities" element={<RequireAuth><EntityListPage /></RequireAuth>} />
        <Route path="/entities/new" element={<RequireAuth><CreateEntityPage /></RequireAuth>} />
        <Route path="/e/:entityId" element={<RequireAuth><EntityLayout /></RequireAuth>}>
          <Route index element={<Navigate to="plan" replace />} />
          <Route path="plan" element={<PlanPage />} />
          <Route path="compare" element={<ComparePage />} />
          <Route path="cash" element={<CashPage />} />
          <Route path="report" element={<ReportPage />} />
          <Route path="connect" element={<ConnectPage />} />
          <Route path="connect/map" element={<MapPage />} />
          <Route path="*" element={<NotFound inShell />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
