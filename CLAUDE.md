# Klaro repo rules

These apply to every change in this repo, by anyone (people or Claude Code).

## Database object names are public

Never put a client name, a person's name or a sensitive term in the name of a table, column,
function, function parameter, schema, view, index, constraint, trigger, policy or enum value.
Use generic business terms (`entities`, `plan_lines`, `vat_rate_code`), never who it is for or
what is being looked into (no `kota_…`, `trinity_…`, `fraud_…`, `investigation_…`).

**Why:** the Supabase REST API reveals object names in exposed schemas to anyone holding the public
key, through spelling hints and 401-versus-404 responses. Row security hides rows, not names. See
`docs/known-limitations.md` (1) and `docs/reports/B3-smoke.md`.

The same goes for migration file names, test fixture names and seed data committed to the repo.
Test identities are made-up ids (`user_ownerA`), never real users or companies.

## Other standing rules

- `C:\Users\peter\Documents\finflow-deploy` (Ledgrly) and `trinity-bookings` are read-only from here.
- Migrations: numbered files in `db/migrations`, applied as plain SQL in one transaction through the
  connector, recorded in `fpa.schema_migrations`. Never `supabase db push` or the connector's
  migration feature. `*_DRAFT.sql` is never applied.
- Every migration is tested as authenticated, anon and service_role with real JWT claims, in
  rolled-back transactions, followed by a read-only check.
- No query relies on the API's default row limit. All data access goes through `src/lib/db.ts`.
- Fail closed: errors reach the caller and the UI; never an empty-looking success.
- No secrets in the repo. `.env.example` lists names only. `npm run check:bundle` after a build.
- Deploy only through GitHub-connected Vercel. Never `vercel --prod` from the CLI.
- Numbers, VAT and policy calls are Peter's. Reports go to `docs/reports/`.
