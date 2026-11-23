# B3 pre-apply: which test runs covered the exact bytes to be applied

23 Nov 2026. **Status: NOT applied yet.** Three of the four tests have passed on the final text. The
fourth, the rollback test, needs a confirmation in the Supabase connector. Both attempts expired
unanswered (10 minutes each), so it has not run on the final text. You asked for every test to be
rerun after the lock change, so I stopped before applying.

## Changes since B2 (your conditions 1 and 2)

- **(1) Lock and unlock.**
  - Editors and owners can lock a version; only an owner can unlock it. An editor who tries gets
    PT403 ("Only an owner can unlock a version.").
  - `fpa.plan_versions` has three new columns: `locked_by`, `unlocked_at` and `unlocked_by`.
    `locked_at` was already there.
  - The server fills these in itself (`auth.jwt()->>'sub'` and `now()`), and any value a client
    sends is replaced. The API can't write the audit columns at all: they have no column grant.
  - They hold the most recent lock and unlock. Locking again doesn't wipe the last unlock record.
  - New tests (3 checks):
    - a sent lock time is ignored, and the locker is recorded;
    - an editor's unlock gets PT403, a viewer's unlock changes nothing, and the audit columns
      can't be written;
    - an owner's unlock is recorded, the version takes changes again, and a new lock records the
      new locker.
  - Schema test total: 627 checks, all passing.
- **(2) Allowed values** for the enumerations are in `docs/reports/B2-enums.md`.

## Files to be applied

Only one file is applied: `db/out/apply_0001.sql`, sent unstripped. It consists of:

- BEGIN;
- 0001, embedded byte for byte;
- one `fpa.schema_migrations` row;
- `db/apply_checks.sql`;
- COMMIT;

`0002_fpa_vat_rules_DRAFT.sql` is not in it: the bundler refuses to build if a draft would be included.

| File applied | SHA-256 | Covered by (complete, passing run on these exact bytes) |
|---|---|---|
| `db/migrations/0001_fpa_schema.sql` | `afacaac26393543dd4ce1880f28e140dc119fcc4d5a2be828ed6e09806e996c6` | **Schema test, run S1 below:** `db/out/test_0001.sql` sent unstripped, 0 failures / 627 passes. **Dry run, run D1:** 10 passes. **Draft test, run V1:** 5 passes. All three embed this file byte for byte. |
| `db/apply_checks.sql` | `67d234ba71fa1b395d5ab04ac471442332a2558ce5fd3a696f6a210d112607a7` | **Dry run, run D1:** the checks passed on the applied state and refused all 9 injected faults. |
| `db/out/apply_0001.sql` (the whole apply transaction) | `733fbb6021f6fab218c051972914bf37c0c3694b60f809a917dc3c740a55e329` | **Dry run, run D1:** `db/out/dryrun_apply.sql` begins with every byte of `apply_0001.sql` except its final `COMMIT;`, then runs the dry-run test and raises. |

## The runs (final text; each one compared byte for byte with the file)

I checked what was sent against the bundle files using this session's own transcript:
`scripts/check-sent.mjs` compares the SHA-256 of each `execute_sql` text
with each file in `db/out/`.

| Run | File sent | SHA-256 of the text sent | Matches file | Result |
|---|---|---|---|---|
| S1 | `db/out/test_0001.sql` | `6a6499d43fc66127…` | yes, exactly | **0 failures, 627 passes** (grants evidence uncut) |
| V1 | `db/out/test_0002_draft.sql` | `61355a94b67438b9…` | yes, exactly | **0 failures, 5 passes** |
| D1 | `db/out/dryrun_apply.sql` | `617f8d9cfe6f47bf…` | yes, exactly | **0 failures, 10 passes; plpgsql_check: 8 functions, 0 findings** |
| R1 | `db/out/test_down.sql` | `2c43b22f81d9deae…` | yes, exactly | **Not run:** the connector's confirmation expired after 10 minutes |
| R2 | `db/out/test_down.sql` (retry) | same | yes, exactly | **Not run:** the confirmation expired again |

All earlier runs (B2) were sent with comments removed, or on earlier revisions of 0001. None of them
is counted above.

The read-only check afterwards (14:31 UTC) found:
- Supabase migration history at **102** rows;
- no `fpa` or `fpa_test` schema;
- `plpgsql_check` not installed.

Nothing persisted.

## What's needed from you

1. Be at the screen so the connector's confirmation prompt for the rollback test can be approved.
   The test contains `DROP SCHEMA fpa CASCADE`, inside a transaction that is always rolled back.
   The earlier comment-stripped runs never prompted; these two did.
2. Once it passes, I'll apply `db/out/apply_0001.sql` exactly as above, then run the read-only checks.
   The apply itself may also ask for a confirmation.
