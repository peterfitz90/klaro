import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'db/out'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Fail closed: an empty catch hides errors.
      'no-empty': ['error', { allowEmptyCatch: false }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // The engine is pure TypeScript: no database access, no React, no browser APIs.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['react', 'react-*', '@supabase/*', '@clerk/*', '../lib/*', '../features/*', '../app/*', '../design/*', '../adapters/*'],
          message: 'src/engine is pure: no React, database, auth or UI imports.' },
      ] }],
      'no-restricted-globals': ['error', 'window', 'document', 'fetch', 'localStorage'],
    },
  },
  {
    // Data access goes through src/lib/db.ts; only src/lib may import supabase-js.
    files: ['src/app/**/*.{ts,tsx}', 'src/features/**/*.{ts,tsx}', 'src/design/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [
        { group: ['@supabase/*'], message: 'Use src/lib/db.ts for all data access.' },
      ] }],
    },
  },
  {
    files: ['db/**/*.mjs', 'scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 2022, globals: globals.node },
  },
);
