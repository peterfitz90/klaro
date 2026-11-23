// DEMO ONLY (npm run dev:demo). Stands in for @clerk/clerk-react: a fixed, signed-in demo user.
// Never imported by the app; vite.demo.config.ts swaps it in, and that config refuses to build.
import type { ReactNode } from 'react';

const auth = { isLoaded: true, isSignedIn: true, userId: 'user_demo', getToken: async () => 'demo' };
export const ClerkProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
export const ClerkFailed = () => null;
export const SignIn = () => <p className="msg msg-warn">Demo: sign-in is not available here.</p>;
export const SignUp = SignIn;
export const useAuth = () => auth;
export const useUser = () => ({ user: { primaryEmailAddress: { emailAddress: 'demo user (fake)' } } });
export const useClerk = () => ({ signOut: async () => { throw new Error('this is the demo; there is no session to end'); } });
