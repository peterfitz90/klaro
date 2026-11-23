/// <reference types="vitest" />
import { readFileSync } from 'node:fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Local sign-in. The shared Clerk production instance accepts only https://<name>.ledgrly.ie on the
// default port (localhost and any port are refused: docs/reports/B4.md). `npm run dev:ledgrly` serves
// Klaro over HTTPS on port 443 under such a name, given (in .env.local, never committed):
//   KLARO_DEV_HOST=klaro-local.ledgrly.ie   (mapped to 127.0.0.1 in the hosts file, by you)
//   KLARO_DEV_CERT=path/to/cert.pem  KLARO_DEV_KEY=path/to/key.pem   (for example made with mkcert)
// Plain `npm run dev` is unchanged.
function ledgrlyDevServer(mode: string, command: string) {
  if (mode !== 'ledgrly' || command !== 'serve') return {};
  const env = loadEnv(mode, process.cwd(), 'KLARO_DEV_');
  const host = env.KLARO_DEV_HOST, cert = env.KLARO_DEV_CERT, key = env.KLARO_DEV_KEY;
  if (!host || !/^[a-z0-9-]+\.ledgrly\.ie$/.test(host) || !cert || !key) {
    throw new Error('dev:ledgrly needs KLARO_DEV_HOST (a name under ledgrly.ie), KLARO_DEV_CERT and KLARO_DEV_KEY in .env.local.');
  }
  return { host: '127.0.0.1', port: 443, strictPort: true, allowedHosts: [host], https: { cert: readFileSync(cert), key: readFileSync(key) } };
}

export default defineConfig(({ mode, command }) => ({
  plugins: [react()],
  // Only VITE_-prefixed variables reach the browser bundle. Server secrets never do
  // (scripts/check-bundle.mjs checks the built output).
  envPrefix: 'VITE_',
  server: ledgrlyDevServer(mode, command),
  build: { sourcemap: false },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'db/**/*.test.mjs', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
}));
