# P1-A: database for Phase 1 (status: built, tests NOT yet run)

24 Nov 2026, branch `phase-1`. **Nothing has been applied.** The rolled-back test runs haven't
happened yet. The connector asks for a confirmation on these bundles, and the first one expired
unanswered (details below). **This report isn't the 1A review yet.** It will be completed with the
test results once the runs go through.

## What is built

| File | What |
|---|---|
| `db/migrations/0003_fpa_actuals_budget_variance.sql` | The migration (sha-256 `c7a3480cf6321fefe9cb3c55d82129a0ed243a77fe1cbaa26b5434e4df5e43de`) |
| `db/apply_checks_0003.sql` | Assertions before `COMMIT`. They check the whole `fpa` schema as it must be after 0003: 16 tables with row security, 42 policies, 26 functions with their exact grants, both checksums, the plan-line seed and the new constraints |
| `db/rollback/0003_down.sql` | A guarded rollback back to the exact state after 0001 |
| `db/tests/0003_phase1.test.sql` | The test: 8 identities with real JWT claims, rolled back |
| `db/tests/0003_down.test.sql` | The rollback test. It ends by running the 0001 apply checks, which must pass again |
| `db/tests/apply_dryrun_0003.test.sql` | The dry run: 12 fault cases that must make the checks refuse, plus `plpgsql_check` |
| `db/tests/fixtures/rounding_cases.json` | Shared rounding cases, worked out independently with Python `Decimal`. The TypeScript engine and the SQL test both use them |
| `src/engine/rounding.ts` (+ tests) | The rounding rule in TypeScript; 37 tests pass, and match the fixture |
| `db/bundle.mjs`, `db/migrate-lib.mjs` | Build the 0003 bundles. Drafts no longer block later files (see `P1-0.md` C7). The Phase 0 bundles still rebuild byte-identical |
| `docs/kpi-definitions.md` | Draft for your sign-off |

| Bundle (`npm run db:bundle`) | sha-256 (first 16) |
|---|---|
| `test_0003.sql` | `d034048768ec1568` |
| `test_down_0003.sql` | `5c44c652fcf9fdfc` |
| `apply_0003.sql` | `34a4dec5d3826426` |
| `dryrun_apply_0003.sql` | `4082a2841b0922e0` |

## What the tests cover (once run)

- **Every role on every new function and table:**
  - owner, editor, viewer, inactive member, non-member, the other entity's owner, anon, service_role;
  - plus a signed-in caller with no user id.
- **Cross-entity checks through every new function**, for example:
  - B's owner importing into A's connection through B's entity;
  - A's version read through B's entity;
  - writing a budget into A's version through B's plan.
- **Import:**
  - permissions;
  - whole-month replacement (January and March untouched, February replaced exactly, April added);
  - account names;
  - the sync log;
  - the connection's fields.
- **Atomicity**, with an injected failure:
  - at the last step (writing the sync log);
  - midway through the inserts.
  - In both cases, deleted months come back exactly and nothing is logged.
- **About 30 kinds of bad input**, including 20,001 rows, more than 5 MB, NaN, Infinity, three
  decimals, future months and duplicates. Exactly 20,000 rows is accepted.
- **Line map:**
  - permissions;
  - every way to name a bad line;
  - the foreign key on direct writes;
  - removal;
  - account_map and unmapped_accounts as every role.
- **Variance**, against 20 hand-computed cells, including:
  - a zero budget (percent null);
  - an unmapped account;
  - a month with no budget;
  - a month with no data at all;
  - the 36-month limit.
- **Budget from actuals:**
  - the 8 shared rounding cases, including a last month that turns negative to absorb the leftover;
  - permissions;
  - the refusals: unmapped accounts, missing months, bad uplifts, a forecast version, another plan's
    version.
- **Locks:** an editor can lock; a locked version is refused; viewers and editors can't unlock; an
  owner can (the Phase 0 rule still holds); rebuilding replaces the version's lines.
- **Grants and structure:** no function executable by anon, service_role or PUBLIC; internal helpers
  still closed.

## Connector confirmation (blocking)

- **What happened.** The first run was the dry run (`dryrun_apply_0003.sql`), at 24 Nov, about 14:10
  UTC. The connector asked for a confirmation, and it expired after 10 minutes with no answer.
- **Nothing ran.** A read-only check afterwards showed:
  - Supabase's migration history: 102 rows;
  - `fpa.schema_migrations`: 1 row;
  - no `plan_line_defs` or `sync_runs`;
  - 20 functions;
  - `plpgsql_check` not installed.
- **Why it asks.** The bundles contain `DELETE` (inside `import_actuals` and the budget function) and
  `DROP CONSTRAINT`. The rollback test also contains `DROP`.
- **What is needed:** you at the screen to approve three rolled-back runs:
  - the dry run;
  - the test;
  - the rollback test.
