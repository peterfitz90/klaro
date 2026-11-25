# Gate 0 checklist

24 Nov 2026, after B5 and the cleanup of the B5 test data. Each item is quoted from the Phase 0 prompt.

| # | Item | Result |
|---|---|---|
| 1 | Row security, grants and function privileges verified as anon, authenticated (and service_role where relevant); cross-entity leak test passes (evidence in docs/reports/) | **PASS** at database level and live API. The browser check with a second user is deferred (known limitation 2) |
| 2 | Typecheck, lint and tests green | **PASS:** passed locally; CI failed at `0159c26`, fixed in `0f2b011`, CI green |
| 3 | Sign-in works on a preview under ledgrly.ie with the shared Clerk instance | **DEFERRED.** Works on production `klaro.ledgrly.ie`; the preview hostname is still on an old build |
| 4 | No Ledgrly table, policy, function or repo file modified (state how you verified) | **PASS** |
| 5 | Supabase migration history row count unchanged | **PASS** (102) |
| 6 | VAT draft rules not applied to production | **PASS** |

Overall: **5 pass, 1 deferred (item 3), none failed.** Item 2 was red in CI at `0159c26`; fixed and green at `0f2b011`. Item 1 passes with the browser second-user
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

**Summary:** passed locally; CI failed at `0159c26`, fixed in `0f2b011`, CI green.

**The failure:**
- GitHub Actions run 45362746252 (job `check`, commit `0159c26`) failed one test:
  `src/app/app.test.tsx`, "entities > switching entity keeps the page".
- It had passed locally, and in CI runs #1 to #4.

**Reproduction:**
- Workflow setup: Node 24.22.3 (the official zip from nodejs.org, checked against its published
  SHA-256, used only from the scratchpad), `npm ci`, `CI=true`.
- `src/app/app.test.tsx` failed **1 run in 20**, with the same test.

**Root cause: the component, not the test.**
- `EntitySwitcher` closed its menu in `useEffect(..., [pathname])`, and that effect also runs after
  the first render.
- The shell first renders when the entity data arrives. That is an ordinary update, after which
  React runs effects in a later task.
- Testing Library's `findBy…` could resolve in that gap. The test's click then opened the menu, and
  the pending effect closed it again.
- Logging inside the clone showed the order: in the failing run "click: toggle" came **before**
  "effect: close"; in passing runs the effect came first.
- A real user clicking the chip in that instant would lose the click.
- The test's own query was fine: `fireEvent.click` applies its update before returning.

**Fix (`0f2b011`):**
- The menu now closes only when the page actually changes. That is checked while rendering, so no
  effect runs after the first render.
- The same gap affected the Ctrl/Cmd+K listener, attached in a `useEffect`: a key press in that
  instant was lost. It is now attached during the commit (`useLayoutEffect`). In `app.test.tsx` the
  palette test had the same exposure.
- The other tests interact only through React's own handlers (submit, change, link click), which are
  not exposed.
- The palette's highlight reset moved from an effect into the typing handler. That is a
  simplification, not a bug fix: typing is an urgent update, so that effect could not lose a key.

**Regression tests** (`src/app/shell/race.test.tsx`):
- Both render as an ordinary update and act from a DOM observer the instant the page appears, as
  `findBy…` did.
- On the old code both failed **10 of 10** runs; with the fix both pass **10 of 10**.

**Timeouts:**
- No longer timeouts and no retries.
- The 5-second Testing Library wait added in B4 for an unexplained one-off failure (most likely this
  race) is **removed**; the default is back.

**After the fix:**

| Where | Result |
|---|---|
| Node 24, `CI=true`, full `npm test` × 20 | 20 of 20 green (58 tests) |
| Same, `app.test.tsx` alone × 20 | 20 of 20 green |
| Same, default timeout restored, full `npm test` × 20 | 20 of 20 green |
| **GitHub Actions run 45373436151** (CI #6, job `check` 138373268837, commit `0f2b011`) | **Success**: typecheck, lint, test (14 files, **58 passed**, including `race.test.tsx`), build, `check:bundle`, all passed. Read on the GitHub web page in your signed-in browser (Actions → run → job log), as `gh` is not installed here |

**Actions versions:**
- `actions/checkout` and `actions/setup-node` moved from v4 to **v7**, one line each. Both v7 releases
  run on Node 24, and v7 keeps the `node-version` and `cache` inputs the workflow uses.
- Run #6's summary shows no annotations, so the Node 20 deprecation warning is gone.

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

FINAL.md: `docs/reports/FINAL.md`.
