// Checks the built browser bundle (dist/) for server secrets. Run after `npm run build`.
// Fails if any file contains a server-only variable name, a Supabase secret or service_role key,
// a Clerk secret key, or a JWT whose role is service_role. Publishable keys are allowed.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { findSecrets } from './secrets-lib.mjs';

const root = process.argv[2] ?? 'dist';
const files = [];
const walk = dir => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p); else files.push(p);
  }
};
walk(root);

// The demo fakes (src/demo, npm run dev:demo) must never be in a real build.
const DEMO_MARKERS = ['DEMO: fake sign-in', 'Demo: sign-in is not available here'];

let bad = 0;
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const hit of findSecrets(text)) {
    bad++;
    console.error(`${f}: ${hit}`);
  }
  for (const m of DEMO_MARKERS) {
    if (text.includes(m)) { bad++; console.error(`${f}: contains the demo fakes ("${m}")`); }
  }
}
if (bad) {
  console.error(`check-bundle: ${bad} finding(s) in ${files.length} file(s). The bundle must not contain server secrets.`);
  process.exit(1);
}
console.log(`check-bundle: ${files.length} file(s) in ${root}, no server secrets and no demo fakes found.`);
