# P1-C: CSV import and account mapping (1B and 1C review stop)

25 Nov 2026, branch `phase-1`. **Nothing is merged to main and no database change was made**: 1B and 1C
are screens only, on top of 0003 (applied 25 Nov). 1D and 1E are not started.

## What changed

| Item | Result |
|---|---|
| 1B: CSV import | Connect › Import: add the CSV connection, choose a file, match the columns, answer two questions, check, import, read the result |
| 1C: account mapping | Connect › Map accounts: a plan line for every account, unmapped first, "Mapping complete", the excluded count and total, suggestions you apply yourself |
| Your §6 wording | Mapping and budget timeouts: "This took too long. Nothing was changed. Try again, and if it keeps happening, tell us." (`docs/ui-rules.md`) |
| Sample files | `public/samples/sample-actuals.csv` (193 rows, 17 made-up accounts, Jan–Dec 2025) and `sample-actuals-broken.csv` (the same with 5 deliberate mistakes). Both download from the import screen |
| Large-file generator | `node scripts/make-actuals-csv.mjs large <folder> [--accounts N] [--months N] [--name-length N]`. Both files are in `C:\Users\peter\Downloads` (table below) |
| Amount formats (your 25 Nov change) | € or £ signs removed, brackets read as negative, with a preview warning that counts them; `$`, other signs, a sign in the wrong currency and anything ambiguous stay problems (`docs/ui-rules.md` §3.3) |
| Checks | Typecheck, lint, **188 tests** and the build pass locally. GitHub Actions only runs on a pull request (see the draft PR link in the chat) |

**The two large files** (made-up data; both under the 5 MB limit as the database measures rows):

| File in `C:\Users\peter\Downloads` | Accounts × months | Rows | File size | Size as the database measures it |
|---|---|---|---|---|
| `large-actuals-16000.csv` | 800 × 20 (Jan 2025–Aug 2026) | 16,000 | 3,279,781 bytes (3.13 MiB) | 4,351,741 bytes |
| `large-actuals-1250-accounts-12-months.csv` | 1,250 × 12 (Jan–Dec 2025) | 15,000 | 3,359,791 bytes (3.20 MiB) | 4,364,751 bytes |

The first is the same file as before, byte for byte (sha-256 `13603bb4ae02ca0f…`). The second is made with
`--accounts 1250 --months 12 --name-length 200`.

## The screens, in plain language

### Connect › Import

The page has two tabs at the top: **Import** and **Map accounts**.

1. **No connection yet.** An owner sees **Add a CSV connection**. An editor or viewer is told that only
   an owner can add one.
2. **Status line.** "Actuals through Dec 2025, last synced 25 Nov 2026, 09:42", or "No actuals imported
   yet".
3. **Choose a file.**
   - A short note on what the file needs.
   - **Choose a CSV file**, **Download the template** and **Download the sample file**.
   - A file over 5 MB, a file that is not UTF-8 or a broken CSV quote is refused at once, with the
     reason and the line.
4. **Match the columns.**
   - Four drop-downs: account code, account name (optional), month and amount. They are filled in from
     the header names where possible.
   - The two questions underneath:
     - **monthly movements or year-to-date balances** (year-to-date uses the plan's financial-year
       start);
     - **is income positive in the file** (if yes, every sign is flipped).
   - **Check the file**.
5. **Check before importing.** Nothing has been sent yet.
   - **Counts:** rows read, blank lines skipped, rows with problems, rows to import, accounts, months,
     debits and credits.
   - **Your two answers**, in words.
   - **Warnings, if any:**
     - the months that were imported before and will be replaced completely;
     - "these look like year-to-date balances" (or monthly movements).
   - **Every problem**, with its line in the file, plus a CSV download of the full list.
   - The first 10 rows exactly as they will be imported.
   - **Import N rows** is the only way forward, and it stays disabled while there is any problem.
6. **Result.**
   - "sample-actuals.csv is imported: 193 rows added, 0 earlier rows removed".
   - Months replaced, rows removed, rows added, actuals through, last synced and your answers.
   - **Map the accounts** button.
7. **If the import fails:**
   - A refusal from the database or a timeout says **"Nothing was imported."** with the reason. A
     server row number is turned into the file's line. A timeout says "This took too long. Try a
     smaller file."
   - If the answer never arrives (network or gateway), it says Klaro **could not confirm** whether the
     import finished, and to check Recent imports before trying again. It never claims success.
8. **Recent imports:** the latest 10, with when, file, months replaced, rows removed and rows added.

### Connect › Map accounts

1. **Status box.** It always shows one of these, based on what is saved:
   - "Mapping not complete: 1 of 17 accounts unmapped…";
   - "✓ Mapping complete: all 17 accounts with actuals are mapped";
   - "No accounts yet. Import a file first."
2. **Excluded line**, always shown, even at 0:
   "Not in the P&L (excluded): 2 accounts, net total €6,936.49 Dr. These stay stored; they are only left
   out of the P&L lines."
3. **Buttons:**
   - **Save N changes**;
   - **Discard changes**;
   - **Use all N suggestions**, which only fills the choices in. A note says nothing is saved until
     Save.
4. **Filters:** All, Unmapped or Excluded, and a search by code or name.
5. **Account list.**
   - Unmapped accounts come first, marked with an amber bar.
   - Each row shows the code and name, months, net total as Dr or Cr, and a plan-line drop-down. The
     drop-down offers only lines an account can be mapped to: no calculated lines and no "Unmapped".
   - Where the name suggests a line, the row says "Suggested: Payroll" with a **Use** button.
   - The list shows 200 accounts at a time, with **Show 200 more**.
   - On a phone each account is a stacked block, with the drop-down at full width.
6. **Viewers** see everything, with the drop-downs disabled and no Save.

## Every rule and its test

`docs/ui-rules.md` §1–3 and §6, the CSV parts of the Phase 1 decisions, and the 1C checklist. The
remaining rules belong to 1D and 1E and get their tests there:

- `docs/ui-rules.md` §4 (budget rebuild) and §5 (incomplete month);
- §2 on Compare, and §6 for Compare and budget;
- `docs/kpi-definitions.md`.

| Rule | Test |
|---|---|
| §1 Lists are read in pages of 1,000 until a short page | `connect/api.test.ts`: 1,234 accounts arrive once each, in order, with ranges 0–999 and 1000–1999; an exact 2,000 needs a third, empty page; a page larger than asked for is refused; `unmapped_accounts` paged the same way |
| §1 An unmapped account on the last page blocks "complete" | `api.test.ts` (it arrives) and `map.test.tsx` ("1 of 1,234 accounts unmapped") |
| §1 A failed page shows an error, not a partial list | `api.test.ts` (page 2 fails, so the call fails) and `map.test.tsx` (error, no table, no status) |
| §1 "Complete" only when every account with actuals is mapped | `map.test.tsx`: not complete with 2 unmapped; complete with all mapped; "No accounts yet" with none |
| §2 Excluded count and net total always shown, also at 0 | `map.test.tsx`: "2 accounts, net total €8,400.00 Dr"; "0 accounts, net total €0.00" |
| §3.1 Monthly or year-to-date; year-to-date converted within each financial year | `actualsImport.test.ts` (financial year from April, two years); `import.test.tsx` (the rows sent) |
| §3.1 A month missing inside a year is an error | `actualsImport.test.ts` (missing in the file, missing for one account, year starting late); `import.test.tsx` (Import disabled) |
| §3.1 Sanity warning when the figures look like the other kind | `actualsImport.test.ts` and `import.test.tsx`, both directions |
| §3.2 Income positive: every sign flipped | `actualsImport.test.ts`; `import.test.tsx` (converted first, then flipped) |
| §3 Answers shown in the preview and the result | `import.test.tsx` (both screens, both answers) |
| §6 Import timeout: "Try a smaller file"; no result figures | `import.test.tsx` |
| §6 Mapping timeout (save and load): your wording; choices kept; no figures | `map.test.tsx` |
| Fail closed: no partial success shown as success | `import.test.tsx`: refused row shows "Nothing was imported" and the file line; unknown outcome shows "could not confirm"; neither shows "imported" |
| Limits: 20,000 rows, 5 MB (file and rows) | `actualsImport.test.ts` (20,001 rows; rows over 5 MB as the database measures them); `import.test.tsx` (a 5 MB + 1 byte file) |
| Row checks: code, name, month (YYYY-MM or a date), amount, duplicates | `actualsImport.test.ts`; `import.test.tsx` with the broken sample: still 5 problems, on lines 4, 6, 9, 11 and 21, each with its reason (line 6 is now `$120.00`, which stays refused) |
| Amounts: € and £ removed, brackets negative, warning with the count (§3.3) | `actualsImport.test.ts`: every accepted form; the warning's exact text and count (an amount with both a sign and brackets counts once); `import.test.tsx`: the warning on screen and the rows sent |
| Amounts: `$`, other signs, wrong currency, brackets with a minus, ambiguous forms stay refused | `actualsImport.test.ts` (26 refused forms, the wrong-currency and bracket-and-minus messages); `import.test.tsx` (`$300` is a problem) |
| The paging-test file passes every check, under 5 MB | `actualsImport.test.ts` (1,250 accounts × 12 months with 200-character names) |
| Size as the server measures it | `actualsImport.test.ts`: 157 bytes, the same as `octet_length(jsonb::text)` measured read-only on the project |
| Suggestions never applied silently | `map.test.tsx`: shown but not set; Use fills in but saves nothing; Save sends exactly the change; "Use all" fills in only accounts that have one |
| Only mappable lines offered | `map.test.tsx` (the drop-down's exact list) |
| Roles | `import.test.tsx` (owner adds, editor cannot, viewer cannot import); `map.test.tsx` (viewer read-only) |
| Errors are not "empty" | `import.test.tsx` (failed connection load is an error, not "no connection") |

**The tests can fail.** I broke seven rules one at a time and ran the tests each time. Each break made
tests fail, and the code was put back afterwards:

| Rule broken | Tests that failed |
|---|---|
| "complete" ignoring unmapped | 3 |
| Import allowed with problems | 2 |
| Paging that stops after one page | 5 |
| Different timeout wording | 1 |
| A suggestion applied without a click | 3 |
| Brackets not read as negative (25 Nov change) | 3 |
| A € or £ accepted in the wrong currency (25 Nov change) | 2 |

**Seen on screen.** I used the demo build (made-up data; it never builds for deploy) at desktop width
and at 390 px. Covered:
- import of the sample, the result and the recent-imports list;
- mapping with all suggestions, then by hand, through to "Mapping complete";
- no sideways scroll at 390 px.

At 390 px the mapping table first scrolled sideways and hid the drop-down. I changed it to one stacked
block per account. The real walk-through below is still needed.

## Choices I made that you may want to change

1. **Dates are read day first:** 01/02/2025 is 1 February. A US-style date such as 12/31/2025 is
   refused, not guessed.
2. **Amounts** (changed on your instruction, 25 Nov):
   - **Allowed:**
     - a minus sign and thousands commas;
     - a € or £ before the number, which is removed. The sign may come before or after the minus,
       with one space after the sign;
     - brackets as a negative: `(1,200.50)`, `(€1,200.50)`, `€(1,200.50)`.
   - **My own addition:** a € in a sterling entity, or a £ in a euro entity, is a problem. Stripping
     it would silently treat pounds as euros.
   - **Refused:**
     - `$` and every other sign;
     - a sign after the number;
     - brackets with a minus sign;
     - European decimal commas (`1.200,50`) and spaces as thousands separators;
     - more than two decimals.
3. **Year-to-date files** need a row for every account in every month of the year, including 0.00
   where there was no balance. A missing row is an error that says to add a 0.00 row. That follows
   "an error, not a guess" strictly. It may be stricter than some exports.
4. **Sanity warning thresholds:**
   - It looks at accounts with 3 or more months in a year.
   - It warns about year-to-date when 60% or more only grow in one direction.
   - It warns about monthly movements when fewer than 40% grow.
5. **Suggestions come from account names, not codes**, because code ranges differ between packages.
   - Names that point to the balance sheet are suggested as excluded: bank, VAT, debtors, creditors,
     "payable", "control" and so on.
   - Names that fit no rule get no suggestion. In the sample, "Clearing 7" has none.
6. **The file must be UTF-8.** Excel's "CSV UTF-8" is. An older ANSI CSV with accents is refused, with
   how to fix it.
7. **One CSV connection per entity** on this screen. The database allows more; the screen shows the
   first.
8. The sample's **Corporation tax** row is only in December, so the sample has 17 accounts and 193 rows.

## Preview hostname

- **25 Nov, before this push:** `klaro-preview.ledgrly.ie` served a build with the live Clerk key
  (bundle `index-CFlKCD17.js`, the same as production). In my browser it was already signed in. The
  development-key problem from B5 is fixed, so no Vercel steps are needed.
- **After this push (`b8fd733`):** Vercel built phase-1 successfully. GitHub's commit status reads
  "Deployment has completed". But `klaro-preview.ledgrly.ie` still serves `index-CFlKCD17.js`, the
  pre-1B build.
  - **Why:** in Vercel › klaro › Settings › Domains, `klaro-preview.ledgrly.ie` is attached to the Git
    branch **`preview`**, not `phase-1`. I read that page and changed nothing.
  - The `preview` branch (`d9acdb3`) is main merged in three times, plus a trigger commit. It differs
    from main only in two older report files.
  - The phase-1 build has a `*.vercel.app` address, but the shared Clerk instance refuses sign-in there
    (B4).
- **Done on your instruction (option A, 25 Nov):**
  - I merged phase-1 into `preview` as `5b38b5b` and pushed it. The merged files are identical to
    phase-1 at `254019f`.
  - Vercel reported "Deployment has completed".
  - `klaro-preview.ledgrly.ie` now serves bundle `index-DcCy4_OD.js`:
    - the live Clerk key, and no development key;
    - the **Import** and **Map accounts** tabs.
  - `/samples/sample-actuals.csv` returns the CSV: first line `account_code,account_name,month,amount`,
    193 rows. The broken copy has `$120.00` on line 6.
  - Seeing the tabs on screen needs an entity. Your account has none on the preview yet, and I created
    no data, so that is step 2 of the walk-through.
- The two options as first written, for the record:
  - **A. Recommended: merge phase-1 into `preview`.** No Vercel setting changes. Say "merge phase-1
    into preview" and I will run `git checkout preview && git merge phase-1 && git push`. Vercel then
    builds `preview` and the hostname updates by itself in about a minute.
  - **B. Point the hostname at `phase-1` in Vercel:**
    1. Go to vercel.com and open the project **klaro**.
    2. Open **Settings › Domains**.
    3. On the `klaro-preview.ledgrly.ie` row, click **Edit**.
    4. Under **Git Branch**, change `preview` to `phase-1` and click **Save**.
    5. Open **Deployments**. On the newest deployment of `phase-1` (commit `b8fd733` or later), click
       **⋯ › Redeploy**, then **Redeploy** again.
- **How you know it worked:**
  - **Connect** shows the two tabs, **Import** and **Map accounts**.
  - `https://klaro-preview.ledgrly.ie/samples/sample-actuals.csv` downloads a CSV whose first line is
    `account_code,account_name,month,amount`. On the old build that address shows the app instead.

## Walk-through for you (on the preview)

Use made-up data for everything you import. Every import adds rows to the shared Supabase project.
Afterwards I will list what was created and delete it only when you say so.

1. Open https://klaro-preview.ledgrly.ie and sign in.
2. **Make sure you are on the new build.** Click **Connect** on the left. You should see two tabs,
   **Import** and **Map accounts**. If you see three cards saying "Not available yet" and no tabs, stop
   and tell me.
3. Create a test entity:
   - Go to **All entities**, then **Create entity**.
   - Name it `Walkthrough Test 1`, Ireland, EUR, year starting January.
4. On **Connect › Import**, click **Add a CSV connection**.
5. **Your real export: check only, do not import.**
   - Click **Choose a CSV file** and pick your real export.
   - Look at the column drop-downs and the two questions, and change them if needed. Then click
     **Check the file** and nothing else.
   - The checks run in your browser. Nothing is sent to the database until **Import**, so do not click
     **Import**.
   - Tell me, without client or account names:
     - whether the columns were guessed right;
     - rows read, rows with problems, accounts, months, debits and credits;
     - any warnings, such as the converted-amounts count or "these look like year-to-date";
     - the first few problems, if any.
   - Then click **Choose another file**.
6. **The broken sample:**
   - Download it from `https://klaro-preview.ledgrly.ie/samples/sample-actuals-broken.csv`.
   - Choose it and click **Check the file**.
   - Expect "5 problems found" on lines 4 (month 2025-13), 6 (`$120.00`, a sign Klaro refuses),
     9 (no account code), 11 (the same account and month twice) and 21 (three decimals).
   - The **Import** button stays greyed out.
   - Click **Download all problems (CSV)** and check that it opens.
7. **The real sample:**
   - Click **Choose another file**, then **Download the sample file**. Choose it and click
     **Check the file**.
   - Expect: rows read 193, rows with problems 0, accounts 17, months Jan 2025 to Dec 2025
     (12 months), both answers in words, and no warnings.
8. Click **Import 193 rows**. Expect:
   - "sample-actuals.csv is imported: 193 rows added, 0 earlier rows removed";
   - Actuals through Dec 2025;
   - one line in Recent imports.
9. **Import the same file again.** Before you import, the preview warns that Jan 2025 to Dec 2025 will
   be replaced completely. Then expect 193 added and 193 earlier rows removed: the whole-month replace.
10. Click **Map the accounts**. Expect:
    - "Mapping not complete: 17 of 17 accounts unmapped";
    - the excluded line showing 0 accounts and €0.00.
11. **Suggestions are not applied on their own.**
    - Click **Use** on one row. "1 unsaved change" appears, and the status still says 17 unmapped.
    - Click **Use all 16 suggestions**, then **Save 16 changes**.
    - Expect "1 of 17 accounts unmapped" (Clearing 7 is listed first) and the excluded line showing
      2 accounts.
12. Set **Clearing 7** to **Other operating costs** and click **Save 1 change**. Expect
    "✓ Mapping complete".
13. **Large file through the real gateway** (checklist).
    - Back on **Import**, open the browser's developer tools (F12) on the **Network** tab.
    - Import `C:\Users\peter\Downloads\large-actuals-16000.csv`.
    - Note the time from clicking Import to the result, and the status of the `import_actuals` request.
    - If the gateway refuses or times out, note the exact message and stop there.
14. **Paging past 1,000 accounts against the real API** (checklist, recorded result).
    - Create a **new** entity, `Walkthrough Test 2` (Ireland, EUR, year starting January).
    - On **Connect**, add a CSV connection.
    - Import `C:\Users\peter\Downloads\large-actuals-1250-accounts-12-months.csv` (15,000 rows).
      Note the time and the `import_actuals` status as in step 13.
    - Open **Map accounts**. Expect:
      - "Mapping not complete: 1,250 of 1,250 accounts unmapped";
      - "Not in the P&L (excluded): 0 accounts, net total €0.00";
      - "Showing 200 of 1,250" under the list.
    - The API returns at most 1,000 rows per request, so a count of 1,250 shows the screen read past
      the cap.
    - In the Network tab, filter on `account_map`. There should be two requests, one for rows 0–999
      and one for 1,000–1,999. Note their status codes.
15. **Phone width.** On your phone or in a narrow window, look at the Import and Map accounts tabs.
    Check that nothing runs off the side and that the drop-downs are usable.
16. **Optional, roles:** a second signed-in user as viewer would show the read-only screens. This is
    still known limitation 2 from Phase 0.

Then tell me what you saw. I will:
- read the two `sync_runs` rows and the account counts read-only;
- fill in the checklist results here;
- wait for your approval before anything merges.
