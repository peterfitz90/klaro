# Gate 0 checklist

24 Nov 2026, after B5 and the cleanup of the B5 test data. Each item is quoted from the Phase 0 prompt.

| # | Item | Result |
|---|---|---|
| 1 | Row security, grants and function privileges verified as anon, authenticated (and service_role where relevant); cross-entity leak test passes (evidence in docs/reports/) | **PASS** at database level and live API. The browser check with a second user is deferred (known limitation 2) |
| 2 | Typecheck, lint and tests green | **PASS** locally (GitHub Actions results not checked: no `gh` on this machine) |
| 3 | Sign-in works on a preview under ledgrly.ie with the shared Clerk instance | **DEFERRED.** Works on production `klaro.ledgrly.ie`; the preview hostname is still on an old build |
| 4 | No Ledgrly table, policy, function or repo file modified (state how you verified) | **PASS** |
| 5 | Supabase migration history row count unchanged | **PASS** (102) |
| 6 | VAT draft rules not applied to production | **PASS** |

Overall: **5 pass, 1 deferred (item 3), none failed.** Item 1 passes with the browser second-user
check deferred.

## Evidence

### 1. Row security, grants, function privileges, cross-entity

- **Schema test, run S1** (`db/out/test_0001.sql`, byte-checked): 0 failures, 627 passes, with real JWT
  claims in rolled-back transactions. Files: `docs/reports/B2-tests.txt` and `docs/reports/B3-preapply.md`.
  It covers:
  - reads in all 13 data tables as owner, editor, viewer, inactive member, signed-in non-member,
    owner of another entity, anon and service_role;
  - 49 write statements, each tried as all 8;
  - cross-entity reads and writes (A against B, and a user in both);
  - helper and function privileges;
  - owner-only unlock.
- **Grants as applied:**
  - `db/tests/GRANTS_EVIDENCE.txt`.
  - `docs/reports/B3.md`: read-only check after the apply. Grants match exactly, 20 function body
    hashes match the repo, and anon and service_role have no USAGE on `fpa`.
- **Live API as anon:** `docs/reports/B3-smoke.md`. Every `fpa` table and RPC is refused (401 `42501`),
  with both public keys. The name-hint leak is accepted as known limitation 1 in
  `docs/known-limitations.md`.
- **Live API signed in:** `docs/reports/B5.md`.
  - A token from the shared instance is accepted (200).
  - A token from an instance Supabase doesn't trust is refused (401), and the app shows the error.
- **Not run:** a second real user in a browser. You deferred it and accepted the risk
  (`docs/reports/B5.md`). It is a required step before the first real second user
  (`docs/known-limitations.md`, 2).

### 2. Typecheck, lint, tests

Run 24 Nov 2026 on `main` (`d52bb6f` plus this report):

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` | 13 files, **56 passed** |
| `npm run build` | exit 0 |
| `npm run check:bundle` | no server secrets, no demo fakes |

- The same commands run in GitHub Actions (`.github/workflows/ci.yml`) on pull requests and on pushes
  to `main`. I could not read the results because `gh` is not installed here; check the repo's Actions tab.
- The database tests are in item 1.

### 3. Sign-in on a preview under ledgrly.ie with the shared instance

- **Production `klaro.ledgrly.ie`:** sign-in on `clerk.ledgrly.ie` worked, with create, switch and
  palette. Run there at your request (`docs/reports/B5.md`).
- **Preview hostname `klaro-preview.ledgrly.ie`:**
  - it still serves its first deployment (`index-B_izLpSG.js`), built with the development key
    (`valid-unicorn-80.clerk.accounts.dev`) and the `/rest/v1/` URL;
  - sign-in there is on the wrong instance, and data requests fail closed (401).
- You are fixing the Vercel setting. To close this item, open the preview after the fix, confirm the
  sign-in box no longer says "Development mode", and sign in once.

### 4. Nothing in Ledgrly modified

- **Repo:**
  - `finflow-deploy` is at `51c5f24` with 0 changed files, the same head as at P0.
  - Its one stash predates this work; nothing was stashed or committed by Klaro work.
  - `trinity-bookings` is at `627d25c` with 0 changed files.
- **Database:** I scanned every SQL statement sent through the connector since the Klaro plan began
  (23 Nov 10:00 UTC; 34 calls across both session transcripts on this machine) for
  CREATE, ALTER, DROP, GRANT, REVOKE, INSERT, UPDATE, DELETE, TRUNCATE and COMMENT outside
  `fpa`/`fpa_test`.
  - None changes a Ledgrly object.
  - The only matches are privilege names inside check text, and `CREATE EXTENSION plpgsql_check` in
    the rolled-back dry runs. The read-only check in `docs/reports/B2-tests.txt` confirms the extension
    was not left installed.
  - The connector's migration feature was never used.
  - Every object Klaro created is in `fpa`, and no foreign key leaves `fpa` (`docs/reports/B3.md`).
- **Settings:**
  - Supabase's Exposed schemas: you added `fpa`.
  - Vercel and Clerk: changed only by you, never by me.

### 5. Supabase migration history

**102 rows** at every check:
- P0 (`docs/reports/P0.md`);
- B2 (`docs/reports/B2-tests.txt`);
- after the apply (`docs/reports/B3.md`);
- after B5 and the cleanup (`docs/reports/B5.md`, 24 Nov 09:09 UTC).

### 6. VAT draft not applied

- `fpa.vat_rules` has **0** rows.
- `fpa.schema_migrations` holds only `0001_fpa_schema.sql` (`afacaac2…`). The checks in
  `docs/reports/B3.md` and `docs/reports/B5.md` confirm both.
- `db/bundle.mjs` refuses to bundle a `*_DRAFT.sql`.
- `0002_fpa_vat_rules_DRAFT.sql` is still waiting for your rate and due-date review.

## Open items before Phase 1

1. **Preview hostname:** fix it in Vercel, then sign in there once (item 3).
2. **Second real user:** the required step in `docs/known-limitations.md` (2).
3. **GitHub Actions:** look at the repo's Actions tab once to confirm CI is green there too.

FINAL.md has not been written.
