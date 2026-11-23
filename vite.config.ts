/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Only VITE_-prefixed variables reach the browser bundle. Server secrets never do
  // (scripts/check-bundle.mjs checks the built output).
  envPrefix: 'VITE_',
  build: { sourcemap: false },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'db/**/*.test.mjs', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
