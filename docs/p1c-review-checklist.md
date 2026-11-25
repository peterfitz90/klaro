# 1C review checklist

The 1C review stop happens on a preview, or on production only after you approve the merge. It needs
every item below done and recorded in `docs/reports/P1-C.md`.

## Walk-through

1. Sign in as a real user on the shared Clerk instance.
2. Add a CSV connection (as an owner), then import the sample fixture. In the preview, check:
   - the row and validation counts;
   - the readable error list, including from a deliberately broken copy of the file;
   - the result summary;
   - the two questions: monthly or year-to-date, and whether income is positive in the file.
3. Map the accounts. Check that:
   - unmapped accounts are listed first;
   - suggestions are shown but never applied without you;
   - "mapping complete" appears only once every page is read and nothing is unmapped;
   - the excluded count and net total are always visible.
4. Write a short screen description in `docs/reports/P1-C.md`.

## Large file through the real gateway (required)

- **One real end-to-end import of a large file** from the browser, as a signed-in user:
  - at least **15,000 rows** and **3 MB or more**;
  - made-up data;
  - generated from the sample fixture's shape: `node scripts/make-actuals-csv.mjs large <folder>`
    writes `large-actuals-16000.csv` (16,000 rows, 3,279,781 bytes; about 4.35 MB as the database
    measures the rows, under its 5 MB limit).
- **Purpose:** to test Supabase's web gateway (request size limits and timeouts), not just the
  database. Every 0003 timing was measured inside the database.
- **Record:**
  - the file's rows and size;
  - the time from upload to the result summary;
  - the HTTP status and response size of the `import_actuals` call (browser network panel);
  - the `sync_runs` row it wrote.
- **If the gateway refuses or times out**, record the exact status and message, and stop. The fix
  would be to lower the per-import limits or split the upload, and that is your decision.
- Both files are in `C:\Users\peter\Downloads` (made 25 Nov 2026):
  - `large-actuals-16000.csv`;
  - `large-actuals-1250-accounts-12-months.csv` (15,000 rows, 3,359,791 bytes;
    `--accounts 1250 --months 12 --name-length 200`).

## Paging past the 1,000-row cap against the real API (required, recorded result)

- Import `large-actuals-1250-accounts-12-months.csv` into a **new** entity, `Walkthrough Test 2`.
- Open **Map accounts**. The status must read **"Mapping not complete: 1,250 of 1,250 accounts
  unmapped"**.
- The API returns at most 1,000 rows per request, so 1,250 proves the screen pages past the cap against
  the real API, not only the fake one in the tests.

| Recorded result (25 Nov 2026; 1C closed) | Value |
|---|---|
| Entity | "test 1". The walk-through used one entity, not a new "Walkthrough Test 2" (see `docs/reports/P1-C.md`) |
| Import: rows, file size, time, `import_actuals` HTTP status | 15,000 rows, 3,359,791 bytes; request body 4,244,933 bytes; **HTTP 200**; 3,866 ms at the server (gateway log) |
| `sync_runs` row (read by Claude afterwards) | `95a73c9d…`: succeeded, 15,000 added, 193 removed (the sample's rows, same months), Jan–Dec 2025, 10:04:57 UTC |
| Map accounts status text | Peter: as expected (1,250 accounts with actuals, all unmapped) |
| `account_map` requests (gateway log) | Two: `Content-Range 0-999` and `1000-1266`, both HTTP 200 (1,267 rows: 1,250 with actuals plus 17 mapped sample accounts with none) |
| Accounts in the database for that entity (read by Claude, read-only) | 1,250 accounts with actuals; 15,000 actual rows; 18 mappings |

## Also confirm

- An import that fails partway shows the error and **nothing saved**. It is never a partial success.
- A timeout shows "This took too long. Try a smaller file." (see `docs/ui-rules.md` §6).
- Phone width: the upload, mapping and result screens at 390 px.
