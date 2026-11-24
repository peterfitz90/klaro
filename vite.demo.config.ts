// `npm run dev:demo`: the app with a fake signed-in user and made-up data, for clicking through the
// screens on this machine (the shared Clerk production instance does not allow localhost). Only the
// dev server uses this file; it refuses to build, so the fakes can never ship.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ command }) => {
  if (command !== 'serve') throw new Error('vite.demo.config.ts is for `npm run dev:demo` only and never builds.');
  return {
    plugins: [react()],
    envPrefix: 'VITE_',
    define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': JSON.stringify('pk_test_ZGVtby5pbnZhbGlkJA'), 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://demo.invalid'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('demo') },
    resolve: { alias: { '@clerk/clerk-react': here('./src/demo/fakeClerk.tsx'), '@supabase/supabase-js': here('./src/demo/fakeSupabase.ts') } },
    server: { port: 5180, strictPort: true },
  };
});
