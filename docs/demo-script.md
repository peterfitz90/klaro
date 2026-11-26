# Klaro demo script (prototype, 27 Nov 2026)

About 8 to 10 minutes. It runs on **klaro-preview.ledgrly.ie**, the `preview` branch.

**Preview or production?**
- **Production** (klaro.ledgrly.ie) serves `main`, so it shows Phase 1 only until you approve the
  phase-2 merge. Steps 1–3 and 6–7 work the same there. Steps 4, 5 and 8 (balances, the cash tiles
  and the budget save) need the merge first.
- **Preview and production share one database.** Anything imported, mapped or saved in the demo
  stays, on both.

## Before the demo (5 minutes, the day before)

1. **Get the files.** Download `sample-balances.csv` from Connect → Import → "Month-end balances" →
   "Download the balances sample". For the optional refusal in step 4, also keep
   `sample-balances-broken.csv`, from `public/samples/` in the repo, at
   `/samples/sample-balances-broken.csv` on the site.
2. **Sign in** on the preview in the browser you will present from. Close other tabs and set the
   zoom to 100%.
3. **Check the starting state of Walkthrough Test 1:**
   - P&L for Jan–Dec 2025 is imported, and mapping is complete.
   - It has two budgets: "Budget Jan 2026 to Dec 2026" and "Budget 2025 (test)".
   - Cash balance and Runway show "—" with "No balances yet".
   - **If the cash tiles already show figures,** the balances were loaded in a rehearsal. Steps 4 and
     5 will then show the end state, not the journey. To show the journey again, use Walkthrough
     Test 2 (step 2 says how).
4. **Know the expected figures:**

   | What | Figure |
   |---|---|
   | Revenue (Dec 2025) | **€65,024.39** |
   | Net profit (Dec 2025) | **€4,095.00** |
   | Cash balance, after mapping | **€95,400.00** |
   | Runway | **7.8** months |
   | Net cash burn | **€12,150.00/month** |

## The walkthrough

| # | Time | Click | What the audience sees | Rough edges to avoid |
|---|---|---|---|---|
| 1 | 0:30 | **Sign in** at klaro-preview.ledgrly.ie. | Klaro opens on Plan for the last entity used. | Sign in before the demo; the Clerk screen takes a few seconds. |
| 2 | 0:45 | **Entity switcher** (top right). Pick **test 1**, then **Walkthrough Test 2**, then **Walkthrough Test 1**. | **test 1:** a big file (15,000 rows) with 1,249 accounts unmapped; Net profit is marked "Incomplete". **Walkthrough Test 2:** empty, so every tile shows "—", never 0. **Walkthrough Test 1:** the demo company. | Don't open Map accounts on test 1: the 1,250-account list is slow to scroll. |
| 3 | 0:45 | Stay on **Plan** and point at the **KPI strip**. | Revenue €65,024.39 and Net profit €4,095.00, "Actuals through Dec 2025". Cash balance and Runway show "—" with "No balances yet". | None. |
| 4 | 1:30 | **Connect → Import.** Point at "Recent imports": the P&L file, type P&L. Choose **"Month-end balances"**, then **Choose a CSV file** → `sample-balances.csv`. The columns are guessed; click **Check the file**. *Optional:* first choose `sample-balances-broken.csv` to show the refusal. | **The check:** 36 balances, 3 accounts, Jan–Dec 2025, "Month-end (closing) balances, trial-balance sign". **Import 36 balances** gives "Imported… Balances through Dec 2025". **The broken file:** "3 problems found", lines 17–19 "2025-13 is not a real date", and Import stays disabled. | Click **Import** only once. A second import is harmless (it replaces the same months), but it adds a line to Recent imports. |
| 5 | 1:30 | **Map the balance accounts.** The section is at the **bottom** of Map accounts. First, briefly open **Plan** to show the cash tiles. Then back on Map accounts: **Use all 3 suggestions** → **Save 3 changes**. Then **Plan**. | **Before mapping:** "3 of 3 balance accounts unmapped", and the suggestions are labelled "Suggested: Cash and bank" or "Not cash (left out)". On Plan, Cash balance and Runway show "—" with "Map your bank accounts to Cash and bank". **After mapping:** Cash balance **€95,400.00**, "Balances through Dec 2025". Runway **7.8**, with "€12,150.00/month net cash burn (includes loans and owner funding)". | **Say:** the burn includes loans and owner funding; profit is positive while cash falls. **Say:** the runway is truncated, never rounded up. Scroll down to the balance section; it is below the 17 P&L accounts. |
| 6 | 2:00 | **Plan → budgets.** Pick **"Budget Jan 2026 to Dec 2026"**. Change **Revenue, Jan 2026** and **Payroll, Feb 2026**, then **Save 2 changes**. Then **Lock this budget**. *Optional:* **New budget from actuals**, name it, then **Create the budget**. | The grid, with revenue as a positive number and the profit lines following the edits. "Saved 2 changes": both are saved, or neither is ("Nothing was saved…" keeps the edits). When locked, the cells can't be edited. A new budget is 8 lines × 12 months, and the months add up exactly. | **Don't** click **Rebuild from actuals…** on the budget you edited: it replaces the hand edits (it warns first). Lock is owner-only to undo: say so rather than unlocking live. |
| 7 | 1:30 | **Compare.** Budget **"Budget 2025 (test)"**, Dec 2025, "Month and YTD". Then switch to **"Budget Jan 2026 to Dec 2026"**. | Budget against actual, the variance, and "▲ Favourable" with a word as well as colour. "Not in the P&L (excluded): 2 accounts, net total €6,936.49 Dr" is always shown. With the 2026 budget against Dec 2025, the Budget column shows "—" with "This budget has no lines in this year", not 0. There is no Cash and bank line: balances never enter the P&L. | Leave the financial-year picker on Jan 2025 to Dec 2025. A year with no actuals shows "—" in Actual, which is correct but makes a dull table. |
| 8 | 0:30 | Back on **Plan**: recap the four tiles. | Revenue, Net profit, Cash balance and Runway, each saying which month it is from. | None. |

**Re-running steps 4 and 5 after the balances are loaded:** Walkthrough Test 1 keeps its balances, so
for a fresh journey use **Walkthrough Test 2**:
1. Connect → **Add a CSV connection**. This needs an owner.
2. Import the P&L sample (Download the sample file → import).
3. Import the balances sample.
4. Map the P&L accounts with **Use all suggestions** plus 9900 → excluded, then map the balance
   accounts.

That adds about 2 minutes.

## Do not click (2B)

- **Cash** in the side menu. It is a placeholder for the forecast, which is not built yet.
- **Report.** It is a placeholder.
- **Connect → "Accounting package" or "MCP-style connection".** They are disabled and say "Not
  available yet".
- **Rebuild from actuals…** on a budget with hand edits. It replaces them.
- **Unlock** on a locked budget in front of the audience. It is owner-only, and Klaro keeps a record
  of every unlock.
- **Map accounts on test 1.** It has 1,250 accounts.
- **Importing the P&L sample again into Walkthrough Test 1.** It replaces the same months, so it is
  harmless but noisy.
- **Sign out** during the demo.
