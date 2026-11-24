# UI rules for Phase 1 (1B to 1E)

These are Peter's conditions from the 1A approval (24 Nov 2026). They bind the UI; each needs a test.

## 1. Page every list; never trust one call

- `account_map` and `unmapped_accounts` return one row per account. The Supabase API caps any result
  at **1,000 rows**, and it does so silently (`206 Partial Content`).
- **Rule:**
  - The UI fetches both through `src/lib/db.ts`, with Range requests of up to 1,000 rows at a time
    (`.range(from, from + 999)`).
  - It keeps going until a page comes back with fewer rows than were asked for.
  - Both functions already return a fixed order (unmapped first, then account code, then
    connection), so pages never overlap or skip.
- **Never show "mapping complete" from a single, unpaged call.** "Complete" means every page has been
  read and none of the accounts is unmapped.
- **Test:** a fixture of more than 1,000 made-up accounts (for example 1,234), served in pages by a
  fake API. The tests check that:
  - every account arrives once, in order;
  - an unmapped account on the last page blocks "mapping complete";
  - a failed page shows an error, not a partial list.

## 2. Excluded accounts are always visible

- The mapping screen and Compare **always** show:
  - how many accounts are mapped to "Not in the P&L (excluded)";
  - their net total.
- This holds even when the count is 0.
- Excluded accounts stay stored in `actuals_monthly`. Nothing deletes them; they are only left out of
  the P&L lines.

## 3. Upload: what the file's numbers mean

The upload step asks two questions before it builds the rows. The answers appear in the preview and
in the result summary.

1. **Are the amounts monthly movements or year-to-date balances?**
   - Default: monthly movements.
   - **Year-to-date:** convert in the browser by taking differences within each fiscal year. The
     fiscal year starts from the plan's `fiscal_year_start`:
     - the first month of the year keeps its YTD figure;
     - every later month is that month's YTD minus the previous month's YTD.
   - A month missing inside a year means the difference can't be worked out. That is an error, not a
     guess.
   - **Sanity warning:** if the figures look like the other kind, the preview warns before import,
     for example when most accounts only ever grow in one direction across a year.
2. **Does income appear as a positive number in the file?**
   - If yes, the browser flips every sign to trial-balance style (debits positive, credits negative)
     before import.
   - The default is no: the file is already trial-balance style, as the template says.

The conversion code lives in `src/engine`, as pure functions with tests. The server checks the rows
as always and is never told which option was chosen.

## 4. Rebuilding a budget over an existing version

- `create_budget_from_actuals` with an existing version **deletes that version's base-scenario lines
  in the 12-month window**, including any manual edits, and writes new ones.
- **Rule:** before the call, the UI:
  - shows how many lines in the window will be replaced, and how many of them were edited by hand
    (origin `manual`);
  - asks for an explicit confirmation.
- Cancel changes nothing.
- A locked version can't be rebuilt; the server refuses it (PT423), and the UI says to unlock first.

## 5. A month that may be incomplete

- If the latest month of actuals is the current calendar month, the KPI strip shows
  **"month may be incomplete"** beside Revenue (month) and Net profit.
- Compare shows the same note on that month's column.
- See `docs/kpi-definitions.md`.
