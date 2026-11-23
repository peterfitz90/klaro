// Sign-in, sign-up, sign-out and the protected-route wrapper, on the shared Clerk instance.
// Nothing here relies on the instance's dashboard defaults (which send users to app.ledgrly.ie):
// every Clerk entry point is given Klaro's own paths, and after sign-in the user goes to Klaro's own
// checked `return` path (src/lib/clerk.ts).
import { ClerkFailed, ClerkProvider, SignIn, SignUp, useAuth, useClerk } from '@clerk/clerk-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AFTER_SIGN_OUT_PATH, HOME_PATH, RETURN_PARAM, SIGN_IN_PATH, SIGN_UP_PATH, clerkPublishableKey, safeReturnPath, signInHref,
} from '../lib/clerk';
import { userMessage } from '../lib/errors';
import { setTokenGetter } from '../lib/supabase';

/** ClerkProvider inside the router, so Clerk navigates with react-router (as Ledgrly does). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const routerPush = useCallback((to: string) => navigate(to), [navigate]);
  const routerReplace = useCallback((to: string) => navigate(to, { replace: true }), [navigate]);
  let key: string;
  try {
    key = clerkPublishableKey();
  } catch (err) {
    return <ConfigError message={userMessage(err)} />;
  }
  return (
    <ClerkProvider
      publishableKey={key}
      routerPush={routerPush}
      routerReplace={routerReplace}
      signInUrl={SIGN_IN_PATH}
      signUpUrl={SIGN_UP_PATH}
      signInFallbackRedirectUrl={HOME_PATH}
      signUpFallbackRedirectUrl={HOME_PATH}
      afterSignOutUrl={AFTER_SIGN_OUT_PATH}
      allowedRedirectOrigins={[window.location.origin]}
    >
      <FailClosed>{children}</FailClosed>
    </ClerkProvider>
  );
}

/**
 * If Clerk cannot start (network, a blocked script, or a domain the instance does not allow, such
 * as localhost for the production instance), say so instead of waiting for ever on "Checking".
 */
function FailClosed({ children }: { children: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <ClerkFailed><MarkFailed onFailed={() => setFailed(true)} /></ClerkFailed>
      {failed ? (
        <ConfigError message={`Sign-in could not start on ${window.location.host}. Check your connection and reload. If this keeps happening, this address may not be allowed by the sign-in service.`} />
      ) : children}
    </>
  );
}

function MarkFailed({ onFailed }: { onFailed: () => void }) {
  useEffect(() => { onFailed(); }, [onFailed]);
  return null;
}

function ConfigError({ message }: { message: string }) {
  return (
    <main className="page" role="alert">
      <h1 className="topbar-title" style={{ margin: '24px 0 12px' }}>Klaro cannot start</h1>
      <p className="msg msg-error">{message}</p>
    </main>
  );
}

function Loading({ label }: { label: string }) {
  return <main className="page"><p className="loading" role="status">{label}</p></main>;
}

/**
 * Renders its children only for a signed-in user, after the Supabase client has the user's Clerk
 * token. Signed-out users go to Klaro's sign-in page with a return path to where they were.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const location = useLocation();
  const [bridged, setBridged] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    setTokenGetter(() => getToken());
    setBridged(true);
    return () => {
      setTokenGetter(null);
      setBridged(false);
    };
  }, [isSignedIn, getToken]);

  if (!isLoaded) return <Loading label="Checking your sign-in…" />;
  if (!isSignedIn) return <Navigate to={signInHref(location.pathname + location.search)} replace />;
  if (!bridged) return <Loading label="Connecting…" />;
  return <>{children}</>;
}

function AuthPage({ children }: { children: ReactNode }) {
  return (
    <main className="auth-wrap">
      <div style={{ textAlign: 'center' }}>
        <h1 className="topbar-title" style={{ fontSize: 28 }}>Klaro</h1>
        <p className="topbar-sub">by Ledgrly</p>
      </div>
      {children}
    </main>
  );
}

/** Klaro's own sign-in page (embedded, path routing under /sign-in). */
export function SignInPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const [params] = useSearchParams();
  const target = safeReturnPath(params.get(RETURN_PARAM));
  if (isLoaded && isSignedIn) return <Navigate to={target} replace />;
  return (
    <AuthPage>
      <SignIn routing="path" path={SIGN_IN_PATH} signUpUrl={SIGN_UP_PATH} forceRedirectUrl={target} signUpForceRedirectUrl={HOME_PATH} />
    </AuthPage>
  );
}

/**
 * Klaro's own sign-up page. The shared instance is invite-only, so this works only from an
 * invitation link that points here (the invitation's ticket is read by Clerk from the URL).
 */
export function SignUpPage() {
  const { isLoaded, isSignedIn } = useAuth();
  if (isLoaded && isSignedIn) return <Navigate to={HOME_PATH} replace />;
  return (
    <AuthPage>
      <SignUp routing="path" path={SIGN_UP_PATH} signInUrl={SIGN_IN_PATH} forceRedirectUrl={HOME_PATH} signInForceRedirectUrl={HOME_PATH} />
      <p className="f-hint" style={{ maxWidth: 400, textAlign: 'center' }}>
        Klaro is invitation-only for now. If you have no invitation, ask the person who manages your Klaro account.
      </p>
    </AuthPage>
  );
}

/** Signs out (of this browser's shared Clerk session) and returns to Klaro's sign-in page. */
export function SignOutButton({ className = 'sidebar-footer-btn' }: { className?: string }) {
  const { signOut } = useClerk();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          signOut({ redirectUrl: AFTER_SIGN_OUT_PATH }).catch((err: unknown) => {
            setBusy(false);
            setError(`Sign-out failed: ${userMessage(err)}`);
          });
        }}
      >
        <span className="nav-icon" aria-hidden="true">⎋</span>Sign out
      </button>
      {error && <p className="f-error" role="alert">{error}</p>}
    </>
  );
}
