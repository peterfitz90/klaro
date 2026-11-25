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
- Which line-map rows a user can see also depends on the `connections_read` policy (see
  `docs/db-notes.md`). Any change to that policy must re-run the `line_map` identity matrix.
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

3. **Amount formats** (Peter, 25 Nov 2026):
   - **Accepted:** `-1200.50`, `1,200.50`, a € or £ sign before the number (removed), and brackets as
     a negative: `(1,200.50)` is -1,200.50.
   - **Preview warning:** how many amounts were converted, and how.
   - **Refused (a problem on that line):**
     - `$` and every other sign, or a sign after the number;
     - a € or £ that is not the entity's currency;
     - brackets with a minus sign;
     - anything else ambiguous (`1.200,50`, `1 000`, more than two decimals).

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

## 6. A call that takes too long

- The database cancels any call that runs longer than its time limit (statement timeout: 8 seconds
  for signed-in users on this project; code `57014`).
- **Rule:** the UI shows a plain message that fits the call:

  | Call | Message |
  |---|---|
  | Import (`import_actuals`) | **"This took too long. Try a smaller file."** |
  | Compare (`variance`) | **"This took too long. Try a shorter date range."** |
  | Mapping, budget | **"This took too long. Nothing was changed. Try again, and if it keeps happening, tell us."** |
  | KPI strip (proposed, 25 Nov; the strip is not live yet) | "This took too long. Try again, and if it keeps happening, tell us." It is a read, so it has no "Nothing was changed". For Peter to confirm |

  It never shows a blank screen, a spinner that never ends, or partial figures.
- Any figures already on screen from that request are cleared, and nothing is saved. The database
  has already undone the call.
- **Test:** a fake API that returns the timeout error for each data call (import, mapping, budget,
  variance). The test checks that the message appears and no figures are shown.
