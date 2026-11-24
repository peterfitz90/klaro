# Klaro Phase 0: final report

24 Nov 2026. Repo `C:\Users\peter\Documents\klaro`, GitHub `peterfitz90/klaro` (private), `main` at
`0f2b011`. Production `https://klaro.ledgrly.ie`. Phase 0 is finished apart from two open items
(end of this report). **Phase 1 has not started.**

## 1. What was done, step by step

**P0, inventory** (`docs/reports/P0.md`). Read-only checks only:
- The connector works.
- Supabase's migration history had **102** rows.
- No `fpa` schema existed.
- I wrote a copy list for the design pieces. Trinity's clean copies were preferred where they
  overlapped.
- Clerk facts that matter here:
  - the instance is invite-only and allows one session per browser;
  - its dashboard defaults send users to `app.ledgrly.ie`.
- The Phase 1 read routes from Ledgrly's journals are listed for your choice.

**B1, scaffold** (`28466db`):
- Vite, React 18, TypeScript (strict), react-router 7, ESLint, Vitest and CI.
- The folder layout from the prompt: app, features, a pure `engine`, `adapters`, `lib` (with `db.ts`
  failing on any error) and `design` (copied, with `PROVENANCE.md`).
- Names only in `.env.example`, and a bundle check for server secrets.

**B2, database** (`27a4162`, then `9c6a392` after your conditions):
- `0001_fpa_schema.sql`: 14 tables, row security on all, 40 policies, 20 functions and explicit grants.
  - Membership in `fpa.entity_members` is the only source of access.
  - `create_entity` creates the entity, your owner membership and a plan in one transaction, with a
    cap of 10 owned entities.
  - After your conditions: owner-only unlock and a lock audit trail.
- The VAT seed is a draft, `0002_fpa_vat_rules_DRAFT.sql`, never applied.
- A guarded rollback script.
- A bundle builder that produces the tests, the dry run and the apply file.
- **627 checks** as 8 identities with real JWT claims, all rolled back.
- Reports: `B2.md`, `B2-tests.txt`, `B2-enums.md`.

**B3, apply and expose** (`de2ef3a`, `04b3d84`):
- `apply_0001.sql` was applied byte for byte as plain SQL in one transaction, with its checks run
  before `COMMIT`.
- Read-only checks afterwards: objects, grants, the 20 function body hashes and the checksum all
  matched the repo, and the migration history was still 102 rows.
- You exposed `fpa`.
- **Smoke test:** with the public key, every read and call was refused. Table names can be guessed
  through the API's spelling hints, which you accepted (`docs/known-limitations.md` 1, and the repo
  rule in `CLAUDE.md`).
- Reports: `B3-preapply.md`, `B3.md`, `B3-smoke.md`.

**B4, app** (`ddfe3c2`):
- Sign-in, sign-up and sign-out on the shared instance, with Klaro's own redirects. The page you
  return to after sign-in is checked to be on Klaro's own site.
- A protected-route wrapper that passes your Clerk token to Supabase before any read.
- Entities: list, create, and a switcher in the header, with the current entity in the URL.
- The shell:
  - Plan, Compare, Cash, Report and Connect;
  - an entity chip;
  - a KPI skeleton with your labels;
  - a Ctrl/Cmd+K palette for the current entity's pages;
  - empty states, an error boundary and a 404 page.
- Demo mode (`npm run dev:demo`) for clicking through locally.
- Report: `B4.md`.

**B5, deploy and end-to-end** (`20514d4` … `3c17ba0`):
- Pushed to GitHub; Vercel deploys from there.
- **Run on production, at your request.** Sign-in, create and switch all passed. The test data was
  then deleted, with your OK.
- **The second-user browser check was deferred, not run.**
- Bundle check on the deployed files passed.
- Phone width: three problems found and fixed.
- Wrong Vercel values were found: a development Clerk key and a Supabase URL ending in `/rest/v1/`.
  Builds now fail on those.
- Report: `B5.md`.

**Gate 0 and the CI fix** (`docs/reports/GATE0.md`):
- 5 items pass and 1 is deferred (the preview hostname).
- CI went red at `0159c26` from a race in the entity switcher. It was reproduced on Node 24, fixed at
  the source, covered by tests that reproduce it every time, and is green at `0f2b011`.

## 2. Files, migrations and checksums (sha-256)

| File | sha-256 | Status |
|---|---|---|
| `db/migrations/0001_fpa_schema.sql` | `afacaac26393543dd4ce1880f28e140dc119fcc4d5a2be828ed6e09806e996c6` | **Applied** 23 Nov 14:50 UTC; recorded in `fpa.schema_migrations` |
| `db/migrations/0002_fpa_vat_rules_DRAFT.sql` | `c52477a986ea57562e31674b564082e45dcd8a9d185b7299dd6e0aff69366656` | **Not applied** (waits for your VAT review) |
| `db/apply_checks.sql` | `67d234ba71fa1b395d5ab04ac471442332a2558ce5fd3a696f6a210d112607a7` | Ran inside the apply, before `COMMIT` |
| `db/out/apply_0001.sql` (built) | `733fbb6021f6fab218c051972914bf37c0c3694b60f809a917dc3c740a55e329` | The exact text applied (checked against the transcript) |
| `db/rollback/0001_down.sql` | `c351b16b6c7940163d338aeab1ebb88b44679cbcadc39d47061bedd4a4972b52` | Never run on production; tested rolled back (R3) |
| `db/ops/2026-11-24_delete_b5_test_entities.sql` | `3c4207b494046f37467ef5136400ca28762f41d8c67071007c48cc3df68aba87` | Run once with your OK; byte-checked |
| `db/tests/0001_fpa_schema.test.sql` | `2d9e844b2b81471da30241e19c024b31132001bfbf200e9c5827d938f8a71d84` | 627 checks |
| `db/tests/0001_down.test.sql` | `c58e25e6a534161b25109a73bf0d823160afca4fe7d2921df1faa84ec6a1617a` | |
| `db/tests/0002_vat_draft.test.sql` | `48cf1fabd147d455f98de124c88ec303111b25f57844c0ef336a3f4945d08363` | |
| `db/tests/apply_dryrun.test.sql` | `0ea46061f60eca13d2d7dfa5d68d5072da650e17907b7c60d4a95267866286f1` | |
| `db/tests/GRANTS_EVIDENCE.txt` | `a1a2e9c92236099dc87c313285958dabedcc646dc04f25fe65530b5cb7ff8584` | Grants, uncut |

Rebuilding the bundles today (`npm run db:bundle`) gives exactly the same sha-256 as the files
tested and applied:

| Bundle | sha-256 |
|---|---|
| `test_0001` | `6a6499d4…` |
| `test_0002_draft` | `61355a94…` |
| `dryrun_apply` | `617f8d9c…` |
| `test_down` | `2c43b22f…` |
| `apply_0001` | `733fbb60…` |

**App source:**
- `src/` (shell, auth, entities, pages, design, demo fakes).
- `vercel.json` (single-page-app rewrite, safe headers, bundle check in the build).
- `vite.config.ts` (fails a Vercel build on wrong public values).
- `vite.demo.config.ts` (demo mode; refuses to build).
- Docs: `CLAUDE.md` (repo rules) and `docs/known-limitations.md`.

## 3. Test evidence

| What | File |
|---|---|
| Database: 627 checks, 8 identities, cross-entity, helpers, functions, constraints, lock rules | `docs/reports/B2-tests.txt`, `docs/reports/B3-preapply.md` (runs S1, V1, D1, R3) |
| Grants as applied, function body hashes, migration history | `docs/reports/B3.md`, `db/tests/GRANTS_EVIDENCE.txt` |
| Live API as anon | `docs/reports/B3-smoke.md` |
| Live sign-in, create and switch; bundle check on deployed files; phone width | `docs/reports/B5.md`, `B5-phone-width-before-fix.jpg`, `B5-phone-width-after-fix.jpg` |
| App: 58 tests in 14 files (race tests included); CI run 45373436151 green | `docs/reports/GATE0.md` (item 2) |
| Gate 0 | `docs/reports/GATE0.md` |
| Nothing in Ledgrly changed | `docs/reports/GATE0.md` (item 4) |

## 4. Deviations from the prompt, and why

1. **B5 was run on production**, not the preview hostname: your call, because the preview still
   served an old build. Gate 0 item 3 stays deferred until the preview signs in.
2. **The second-user check in a browser was not run.** You deferred it and accepted the risk. It is
   a required step before the first real second user (`known-limitations.md` 2).
3. **Schema choices beyond the prompt** (all in `B2.md`):
   - id and timestamps on `schema_migrations`;
   - the financial-year start as a month;
   - enumeration values (listed in `B2-enums.md`);
   - VAT rules readable only once verified;
   - entities not deletable through the API, and jurisdiction and currency fixed after creation;
   - only owners add connections;
   - driver values as `numeric(18,6)`;
   - a version lock with owner-only unlock and an audit trail (your condition).
4. **Additions not in the prompt:**
   - demo mode;
   - the config guard that fails a Vercel build on a development Clerk key or a wrong Supabase URL;
   - `vercel.json` headers;
   - an opt-in local sign-in mode (`dev:ledgrly`, unverified; you chose not to use it).
5. **Some early B2 test runs were sent with comments removed, or in shortened form.** They were
   superseded: final coverage counts only byte-checked runs on the exact files.
6. **"Two parallel calls cannot slip past the 10-entity cap"** is proven by mechanism (a per-user
   lock held until commit, which a test confirms), not by two real calls at once. B2 planned a live
   concurrency test for B5; it was not run.

## 5. Risks, surprises and what needs your decision

**Open items (Phase 0):**
- **Preview hostname:** `klaro-preview.ledgrly.ie` still serves its first build, with the
  development key and the `/rest/v1/` URL. Fix the Preview variables, or point the domain at Git
  branch `preview`, then sign in there once.
- **Second real user:** the required step before giving anyone else access.

**Surprises found and handled:**
- **Production Clerk refuses `localhost`** and any port other than 443 on `https://<name>.ledgrly.ie`.
  Local click-through is demo mode.
- **Vercel was first built with Ledgrly's development Clerk key and a wrong Supabase URL.** Builds
  now fail on both.
- **On a phone, Sign out was unreachable** and the top bar ran off the screen. Both fixed.
- **A real race:** a click or Ctrl+K in the instant after the shell appears was lost. Fixed, with
  tests that reproduce it every time.
- **The API's spelling hints reveal `fpa` table and function names.** Accepted, and covered by the
  repo naming rule.

**Known, accepted:**
- Signing out of Klaro signs that browser out of Ledgrly.
- Clerk's emails say "Ledgrly".
- The instance is invite-only. Self-service sign-up for Klaro-only customers needs a decision: open
  sign-up with a guard, or a separate Clerk instance.

**Still yours to decide:**
- **VAT:** every rate and due-date rule in the 0002 draft, against Revenue and GOV.UK, before it is
  applied.
- **Enumeration values** in `B2-enums.md`. Changing them now needs a numbered migration.
- **Ledgrly guard:** a small change to live Ledgrly so a Klaro-only user who opens Ledgrly isn't
  offered the create-company wizard. That needs your approval as a separate piece of work, and should
  come before inviting anyone outside Ledgrly.
- **Design tokens:** there are now three copies (Ledgrly, Trinity, Klaro). Extracting a shared
  package is worth scheduling.
- **Billing:** out of Phase 0.

## 6. Proposed Phase 1: actuals and budget (plan only; not started)

**Goal:** an entity gets monthly actuals per account from a source, maps accounts to plan lines,
builds a budget from those actuals, and sees budget against actual by month.

Same rules as Phase 0:
- every migration tested as each role, rolled back, then a read-only check;
- no reliance on the API row limit;
- fail closed;
- server functions verify the Clerk session and membership;
- reports in `docs/reports/`.

Suggested steps, each stopping for your review like B2 and B3.

### 1A. The write path for actuals (database)

- **Migration 0003:** `fpa.record_actuals(connection_id, rows jsonb)`, SECURITY DEFINER with a fixed
  `search_path`. It checks that the caller is an owner of the connection's entity, that every period
  is a month start, that amounts fit `numeric(14,2)` and that account codes are valid. It then
  replaces the given months for that connection in one transaction (delete and insert, by period),
  and sets `last_synced_at` and `actuals_through`.
- `actuals_monthly` stays unwritable by API roles directly, as now.
- A cap on rows per call (for example 5,000), with an error that names the limit rather than
  truncating.
- Tests as in B2: as every role, cross-entity, wrong owner, bad periods, oversize, rollback on any bad
  row.
- **Decision for you:** whether a sync replaces whole months (simple and idempotent; proposed) or
  merges by account.

### 1B. CSV import (first connector, no Ledgrly dependency)

- **Format:** `account_code, account_name, period (YYYY-MM), amount`, net movement per month and
  debit-positive, in the entity's currency. An optional trial-balance layout can be converted in
  the browser.
- **Parsing in `src/engine`** (pure TypeScript, unit-tested):
  - amounts as exact decimal strings, never floats;
  - months validated;
  - duplicates rejected;
  - a per-file total check: the sum of the months must match a total you enter, if you want that.
- **Preview before saving:** rows, months covered, totals per month, and any rows rejected with the
  reason. Nothing is saved until you confirm. Saving calls `record_actuals` through `src/lib/db.ts`.
- Implements the existing `Connector` interface (`src/adapters/connector.ts`), source type `csv`.

### 1C. Line map

- **A mapping screen:** each source account goes to a plan line and an optional VAT rate code.
  - Suggestions come from account names and codes; they are never applied without you.
  - Unmapped accounts are listed and block the budget step, rather than silently falling out.
- **A fixed starter set of plan lines** (revenue, cost of sales, overheads by kind, and so on).
  **The list itself is your decision before 1C.**

### 1D. Budget from actuals

- **"Create budget"** makes a `plan_versions` row (kind `budget`) with a base scenario.
- **It seeds `plan_lines`** from the mapped actuals of a chosen base year, month by month:
  - origin `driver` or `manual`;
  - an optional uniform growth percentage, as one driver.
- **The arithmetic runs in `src/engine`** with exact decimal maths and rounding rules you approve
  (proposed: round half-up to cents at line level, with no reallocation across months).
- **Locking** uses the Phase 0 lock rules: editors lock, owners unlock.

### 1E. Variance (Compare page)

- **A server-side aggregate** (a SQL function) returns budget and actual per plan line and month for
  a version. That avoids reading row by row and any row limit.
- **The Compare page shows:**
  - budget, actual, variance and variance %, by month and year to date;
  - favourable or unfavourable by line type;
  - CSV export through the copied `ExportDropdown`.
- **The KPI strip** starts showing real figures here: Revenue (month), Net profit, Cash balance,
  Runway (months). The definitions of Cash balance and Runway need your sign-off, as they depend on
  balance-sheet actuals.

### 1F. Ledgrly as a source (after 1A–1E work on CSV)

- **Your choice of route, from `P0.md` section 4:**
  1. **Recommended:** a new SECURITY INVOKER `public.monthly_account_balances(company_id, from, to)`
     in Ledgrly, called with the user's own token, so Ledgrly's row security decides access. This is
     a change to Ledgrly and needs your approval.
  2. **No Ledgrly change:** page through journals with the user's token.
  3. **Not recommended:** call it with service_role.
- **Links between Klaro and Ledgrly:**
  - `entities.ledgrly_company_id` links the two, with no foreign key;
  - a Klaro user must also be a member of that Ledgrly company;
  - exclude "Kota IE - 1" and the other test companies.

**Before Phase 1 starts, from you:**
1. The plan-line list (1C).
2. Whole-month replace for syncs (1A).
3. Budget rounding rules (1D).
4. KPI definitions (1E).
5. The Ledgrly route (1F).
6. The VAT draft review. Only needed before VAT timing (cash, Phase 2), not for 1A–1E.
