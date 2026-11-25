// @vitest-environment jsdom
// The app's routes and fail-closed behaviour, with Clerk and the entity API replaced by fakes.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = { isLoaded: true, isSignedIn: false, userId: null as string | null, getToken: vi.fn(async () => 'token') };
const clerkState = { failed: false };
vi.mock('@clerk/clerk-react', () => ({
  ClerkProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ClerkFailed: ({ children }: { children: React.ReactNode }) => (clerkState.failed ? <>{children}</> : null),
  SignIn: (p: { forceRedirectUrl?: string }) => <div data-testid="clerk-sign-in">{p.forceRedirectUrl}</div>,
  SignUp: () => <div data-testid="clerk-sign-up" />,
  useAuth: () => auth,
  useUser: () => ({ user: null }),
  useClerk: () => ({ signOut: vi.fn(async () => undefined) }),
}));
const setTokenGetter = vi.fn();
vi.mock('../lib/supabase', () => ({ setTokenGetter: (f: unknown) => setTokenGetter(f), fpaClient: () => { throw new Error('no db in tests'); } }));

const A = { id: '0b483fe4-e952-4170-83b5-a79b911b8023', name: 'Acme Ltd', jurisdiction: 'IE', currency: 'EUR' };
const B = { id: '11111111-2222-4333-8444-555555555555', name: 'Brit Co', jurisdiction: 'UK', currency: 'GBP' };
const api = {
  listEntities: vi.fn(async () => [A, B]),
  getEntity: vi.fn(async (id: string) => [A, B].find(e => e.id === id) ?? null),
  myRole: vi.fn(async () => 'owner' as const),
  createEntity: vi.fn(async () => B.id),
};
vi.mock('../features/entities/api', () => api);

// Node 25+ defines its own (empty) localStorage global, which hides jsdom's; give the tests one.
const store = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', 'pk_test_fake');
const { App } = await import('./App');

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
function at(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>);
}

beforeEach(() => {
  auth.isSignedIn = true; auth.userId = 'user_test1'; clerkState.failed = false;
  window.localStorage.clear();
  vi.clearAllMocks();
  api.listEntities.mockImplementation(async () => [A, B]);
  api.getEntity.mockImplementation(async (id: string) => [A, B].find(e => e.id === id) ?? null);
  api.myRole.mockImplementation(async () => 'owner');
  api.createEntity.mockImplementation(async () => B.id);
});
afterEach(cleanup);

describe('auth', () => {
  it('a signed-out user is sent to Klaro’s own sign-in, with a return path', async () => {
    auth.isSignedIn = false; auth.userId = null;
    at(`/e/${A.id}/cash`);
    expect(await screen.findByTestId('clerk-sign-in')).toBeTruthy();
    expect(screen.getByTestId('where').textContent).toBe(`/sign-in?return=${encodeURIComponent(`/e/${A.id}/cash`)}`);
    // After sign-in Clerk is told to go back there (forceRedirectUrl), not to Ledgrly.
    expect(screen.getByTestId('clerk-sign-in').textContent).toBe(`/e/${A.id}/cash`);
    expect(api.getEntity).not.toHaveBeenCalled();
  });
  it('a return path to another site is replaced by Klaro’s home', async () => {
    auth.isSignedIn = false;
    at('/sign-in?return=https%3A%2F%2Fapp.ledgrly.ie%2F');
    expect((await screen.findByTestId('clerk-sign-in')).textContent).toBe('/');
  });
  it('if Clerk cannot start, the page says so and loads nothing (no endless "Checking")', async () => {
    clerkState.failed = true; auth.isLoaded = false;
    at(`/e/${A.id}/plan`);
    expect((await screen.findByRole('alert')).textContent).toContain('Sign-in could not start');
    expect(api.getEntity).not.toHaveBeenCalled();
    auth.isLoaded = true;
  });
  it('the token bridge is set before any data is read', async () => {
    at(`/e/${A.id}/plan`);
    await screen.findByText('Drivers');
    expect(setTokenGetter).toHaveBeenCalled();
    expect(setTokenGetter.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(api.getEntity.mock.invocationCallOrder[0] ?? -Infinity);
  });
});

describe('entities', () => {
  it('"/" goes to the first entity, or the last one opened by this user', async () => {
    at('/');
    await screen.findByText('Drivers');
    expect(screen.getByTestId('where').textContent).toBe(`/e/${A.id}/plan`);
    cleanup();
    window.localStorage.setItem('klaro.lastEntity.user_test1', B.id);
    at('/');
    await screen.findByText('Drivers');
    expect(screen.getByTestId('where').textContent).toBe(`/e/${B.id}/plan`);
  });
  it('"/" with no entities goes to the create form', async () => {
    api.listEntities.mockImplementation(async () => []);
    at('/');
    expect(await screen.findByRole('button', { name: 'Create entity' })).toBeTruthy();
  });
  it('the shell shows the entity chip, tasks and the live KPI strip (no figures when it cannot load)', async () => {
    at(`/e/${A.id}/plan`);
    await screen.findByText('Drivers');
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    expect(screen.getByText('IE · EUR')).toBeTruthy();
    for (const t of ['Plan', 'Compare', 'Cash', 'Report', 'Connect']) expect(screen.getAllByRole('link', { name: new RegExp(t) }).length).toBeGreaterThan(0);
    // The live strip (signed off 25 Nov 2026), not the placeholder. With no database in this test it
    // fails closed: "—" in every tile and the reason, never a zero.
    const strip = screen.getByRole('region', { name: 'Key figures' });
    expect(screen.queryByRole('region', { name: 'Key figures (no data yet)' })).toBeNull();
    expect(await within(strip).findAllByText(/Could not load the figures/)).toHaveLength(4);
    expect(within(strip).getAllByText('—')).toHaveLength(4);
  });
  it('the KPI strip is not on Connect (setup pages have no strip)', async () => {
    at(`/e/${A.id}/connect`);
    await screen.findByText('CSV import');
    expect(screen.queryByRole('region', { name: /Key figures/ })).toBeNull();
  });
  it('switching entity keeps the page', async () => {
    at(`/e/${A.id}/cash`);
    await screen.findByText('No cash forecast yet');
    fireEvent.click(screen.getByTitle('Switch entity'));
    fireEvent.click(screen.getByRole('link', { name: /Brit Co/ }));
    await screen.findByText('UK · GBP');
    expect(screen.getByTestId('where').textContent).toBe(`/e/${B.id}/cash`);
  });
  it('fails closed: a load error shows the error and no entity page', async () => {
    api.getEntity.mockImplementation(async () => { throw Object.assign(new Error('load entity: permission denied for schema fpa'), { code: '42501' }); });
    at(`/e/${A.id}/plan`);
    expect(await screen.findByText('You do not have access to this.')).toBeTruthy();
    expect(screen.queryByText('Drivers')).toBeNull();
    expect(screen.queryByText('Acme Ltd')).toBeNull();
  });
  it('fails closed: no membership looks the same as not found, and shows nothing of the entity', async () => {
    api.myRole.mockImplementation(async () => null as never);
    at(`/e/${A.id}/plan`);
    expect(await screen.findByText('This entity does not exist, or you are not a member of it.')).toBeTruthy();
    expect(screen.queryByText('Acme Ltd')).toBeNull();
  });
  it('a malformed entity id in the URL shows "no entity" without a query', async () => {
    at('/e/not-a-uuid/plan');
    expect(await screen.findByText('No entity here')).toBeTruthy();
    expect(api.getEntity).not.toHaveBeenCalled();
  });
  it('create form: checks fields, then shows the database error instead of moving on', async () => {
    api.createEntity.mockImplementation(async () => { throw Object.assign(new Error('create entity: You already own 10 entities, which is the most allowed.'), { code: 'PT429', what: 'create entity' }); });
    at('/entities/new');
    fireEvent.click(await screen.findByRole('button', { name: 'Create entity' }));
    expect(await screen.findByText('Enter a name of 1 to 120 characters.')).toBeTruthy();
    expect(api.createEntity).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Co' } });
    fireEvent.change(screen.getByLabelText('Jurisdiction'), { target: { value: 'UK' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create entity' }));
    expect(await screen.findByText('You already own 10 entities, which is the most allowed.')).toBeTruthy();
    expect(api.createEntity).toHaveBeenCalledWith({ name: 'New Co', jurisdiction: 'UK', currency: 'GBP', fiscalYearStart: 1 });
    expect(screen.getByTestId('where').textContent).toBe('/entities/new');
  });
  it('create form: success opens the new entity', async () => {
    at('/entities/new');
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Brit Co' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create entity' }));
    await screen.findByText('Drivers');
    expect(screen.getByTestId('where').textContent).toBe(`/e/${B.id}/plan`);
  });
});

describe('shell extras', () => {
  it('Ctrl+K opens the palette with this entity’s pages; Enter opens one; Escape closes', async () => {
    at(`/e/${A.id}/plan`);
    await screen.findByText('Drivers');
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'report' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('No reports yet');
    expect(screen.getByTestId('where').textContent).toBe(`/e/${A.id}/report`);
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.keyDown(await screen.findByRole('combobox'), { key: 'Escape' });
    expect(screen.queryByRole('combobox')).toBeNull();
  });
  it('unknown pages are a 404, inside and outside an entity', async () => {
    at(`/e/${A.id}/nope`);
    expect(await screen.findByText('Page not found')).toBeTruthy();
    cleanup();
    at('/nowhere');
    expect(await screen.findByText('Page not found')).toBeTruthy();
  });
  it('a page that crashes shows the error page, not a blank screen', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { ErrorBoundary } = await import('./ErrorBoundary');
    const Boom = () => { throw new Error('boom'); };
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    quiet.mockRestore();
  });
});
