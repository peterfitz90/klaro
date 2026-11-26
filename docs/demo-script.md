# Klaro demo script (prototype, 27 Nov 2026)

About 8 to 10 minutes, plus 2 for Scenarios. It runs on **klaro-preview.ledgrly.ie**, the `preview` branch.

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
| 2 | 1:00 | **Entity switcher** (top right). Pick **test 1**. Then **+ Create entity**: name it **Walkthrough Test 3** (Ireland, EUR, year from January), then **Create entity**. Then switch to **Walkthrough Test 1**. | **test 1:** a big file (15,000 rows) with 1,249 accounts unmapped; Net profit is marked "Incomplete". **Walkthrough Test 3:** a brand-new, empty entity, so every tile shows "—", never 0. **Walkthrough Test 1:** the demo company. | Create Walkthrough Test 3 while signed in as the owner account; whoever creates an entity becomes its owner. **Walkthrough Test 2 is no longer empty** (see below), so don't use it to show "—". Don't open Map accounts on test 1: the 1,250-account list is slow to scroll. |
| 3 | 0:45 | Stay on **Plan** and point at the **KPI strip**. | Revenue €65,024.39 and Net profit €4,095.00, "Actuals through Dec 2025". Cash balance and Runway show "—" with "No balances yet". | None. |
| 4 | 1:30 | **Connect → Import.** Point at "Recent imports": the P&L file, type P&L. Choose **"Month-end balances"**, then **Choose a CSV file** → `sample-balances.csv`. The columns are guessed; click **Check the file**. *Optional:* first choose `sample-balances-broken.csv` to show the refusal. | **The check:** 36 balances, 3 accounts, Jan–Dec 2025, "Month-end (closing) balances, trial-balance sign". **Import 36 balances** gives "Imported… Balances through Dec 2025". **The broken file:** "3 problems found", lines 17–19 "2025-13 is not a real date", and Import stays disabled. | Click **Import** only once. A second import is harmless (it replaces the same months), but it adds a line to Recent imports. |
| 5 | 1:30 | **Map the balance accounts.** The section is at the **bottom** of Map accounts. First, briefly open **Plan** to show the cash tiles. Then back on Map accounts: **Use all 3 suggestions** → **Save 3 changes**. Then **Plan**. | **Before mapping:** "3 of 3 balance accounts unmapped", and the suggestions are labelled "Suggested: Cash and bank" or "Not cash (left out)". On Plan, Cash balance and Runway show "—" with "Map your bank accounts to Cash and bank". **After mapping:** Cash balance **€95,400.00**, "Balances through Dec 2025". Runway **7.8**, with "€12,150.00/month net cash burn (includes loans and owner funding)". | **Say:** the burn includes loans and owner funding; profit is positive while cash falls. **Say:** the runway is truncated, never rounded up. Scroll down to the balance section; it is below the 17 P&L accounts. |
| 6 | 2:00 | **Plan → budgets.** Pick **"Budget Jan 2026 to Dec 2026"**. Change **Revenue, Jan 2026** and **Payroll, Feb 2026**, then **Save 2 changes**. Then **Lock this budget**. *Optional:* **New budget from actuals**, name it, then **Create the budget**. | The grid, with revenue as a positive number and the profit lines following the edits. "Saved 2 changes": both are saved, or neither is ("Nothing was saved…" keeps the edits). When locked, the cells can't be edited. A new budget is 8 lines × 12 months, and the months add up exactly. | **Don't** click **Rebuild from actuals…** on the budget you edited: it replaces the hand edits (it warns first). Lock is owner-only to undo: say so rather than unlocking live. |
| 7 | 1:30 | **Compare.** Budget **"Budget 2025 (test)"**, Dec 2025, "Month and YTD". Then switch to **"Budget Jan 2026 to Dec 2026"**. | Budget against actual, the variance, and "▲ Favourable" with a word as well as colour. "Not in the P&L (excluded): 2 accounts, net total €6,936.49 Dr" is always shown. With the 2026 budget against Dec 2025, the Budget column shows "—" with "This budget has no lines in this year", not 0. There is no Cash and bank line: balances never enter the P&L. | Leave the financial-year picker on Jan 2025 to Dec 2025. A year with no actuals shows "—" in Actual, which is correct but makes a dull table. |
| 8 | 0:30 | Back on **Plan**: recap the four tiles. | Revenue, Net profit, Cash balance and Runway, each saying which month it is from. | None. |

**Re-running steps 4 and 5 after the balances are loaded:** Walkthrough Test 1 keeps its balances, so
it shows the end state.

**Walkthrough Test 2 is no longer empty.** It was loaded during your review (26 Nov 2026) with:
- the P&L sample;
- the balances sample;
- a budget, "Review budget 2026", with two hand edits.

**Its figures differ from Test 1's,** and the difference is account **9900 Clearing 7**:

| | 9900 mapped to | Net profit (Dec 2025) | Excluded accounts |
|---|---|---|---|
| Walkthrough Test 1 | **Other operating costs** | **€4,095.00** | 2, net €6,936.49 Dr |
| Walkthrough Test 2 | Not in the P&L (excluded) | €4,099.18 | 3, net €7,786.12 Dr |

Mapping 9900 to Other operating costs reproduces Test 1's €4,095.00. I checked both mappings in the
database on 26 Nov 2026.

**For a fresh journey, use the new Walkthrough Test 3** from step 2:
1. Connect → **Add a CSV connection**. This needs the owner.
2. Import the P&L sample: Download the sample file, then import it.
3. Map the P&L accounts with **Use all suggestions**. Then set **9900 Clearing 7 → Other operating
   costs**, so the figures match Test 1 (€4,095.00), and Save.
4. Import the balances sample, then map the balance accounts (Use all 3 suggestions → Save).

That adds about 2 minutes.

## Demo data to keep (nothing is deleted)

- **test 1**
- **Walkthrough Test 1**
- **Walkthrough Test 2**
- **Walkthrough Test 3** (created live in step 2)
- **"Budget 2025 (stretch)"** on Walkthrough Test 2 (created during the review, 26 Nov 2026; the Report demo budget)

These stay as the prototype's demo data. The proposed delete script is not run.

## Final 2 minutes: Scenarios (Phase 3 slice)

The Scenarios panel sits under the budget grid on Plan. `SCENARIOS_LIVE` is on after its walk-through
on the preview (26 Nov 2026).

**Starting state:**
- "Budget 2025 (test)" already has two saved scenarios, from the walk-through:
  - **Upside:** revenue +10%, payroll +5%;
  - **Downside:** revenue −10%.
- "Budget Jan 2026 to Dec 2026" was locked in step 6.

| # | Time | Click | What the audience sees | Rough edges to avoid |
|---|---|---|---|---|
| 9 | 1:15 | **Plan.** In the budget picker choose **"Budget 2025 (test)"**, then scroll below the grid to **Scenarios: Jan 2025 to Dec 2025**. Change **Upside: Payroll change %** from 5 to **8**, then **Save scenarios**. | Base, Upside and Downside side by side. Base: Revenue €724,564.25, Total costs €631,134.69, Net profit €93,429.56. Upside before the change: €797,020.68, €671,548.28, €125,472.40. Downside: €652,107.83, €604,679.71, €47,428.12. **Closing cash, month 12 (indicative):** after step 5, €95,400.00 + the year's profit (Base €188,829.56, Upside €220,872.40, Downside €142,828.12), with the caveat "indicative: profit used as a proxy for cash; ignores timing, VAT, tax, capex and financing". Without balances, it shows "—" and says why. After the change: "Scenarios saved". | Say that cost of sales moves with revenue; marketing, rent, interest and tax don't move. Change one figure at a time: the table updates as you type. |
| 10 | 0:45 | Choose **"Budget Jan 2026 to Dec 2026"**, the one locked in step 6. | Its scenarios can be seen but not changed: "This budget is locked: you can see its scenarios, but they cannot be changed or saved." Upside and Downside show as "not saved yet", at 0%. | None. |

### Do not click (Scenarios)

- **Delete** on a saved scenario. It asks first ("Delete it" / "Keep"). If it is deleted, its drivers
  go with it, and nothing is lost elsewhere; but avoid it live.
- **Add a scenario** more than twice. At five it stops, with "At most 5 scenarios, Base included";
  that is fine, but it is noise.
- **A percentage with three decimals, or above 1000.** The row shows the problem and Save refuses;
  that is correct, but distracting.
- **Saving scenarios on an unlocked budget you don't want changed.** Saves are real and shared with
  production.

## Do not click (2B)

- **Cash** in the side menu. It is a placeholder for the forecast, which is not built yet.
- **Report on production** before phase-3 is merged. It is still the placeholder there; on the preview
  it is the monthly report (the last 2 minutes below).
- **Connect → "Accounting package" or "MCP-style connection".** They are disabled and say "Not
  available yet".
- **Rebuild from actuals…** on a budget with hand edits. It replaces them.
- **Unlock** on a locked budget in front of the audience. It is owner-only, and Klaro keeps a record
  of every unlock.
- **Map accounts on test 1.** It has 1,250 accounts.
- **Importing the P&L sample again into Walkthrough Test 1.** It replaces the same months, so it is
  harmless but noisy.
- **Sign out** during the demo.

## Final 2 minutes: Report (Phase 3)

The monthly board pack. `REPORT_LIVE` is on in `phase-3` and on the preview. Production keeps the
placeholder until phase-3 is merged. The report only reads; opening it writes nothing.

**The Report demo entity is Walkthrough Test 2.**
- It has balances, so the cash figures show.
- It has a real budget to compare against: "**Budget 2025 (stretch)**", created during your review
  from the 2025 actuals with these uplifts: Revenue +6%, Cost of sales +4%, Payroll +3%, Marketing
  −15%.
- The report picks that budget by default for Dec 2025.

Walkthrough Test 1 is not used here. Its "Budget 2025 (test)" is a copy of its actuals, so every
variance there is €0.00, and it has no balances (none are to be loaded into it).

**The header shows the signed-in user's email address** ("Generated … by …"). That is also in any
PDF you print, so present from the account you are happy to show.

| # | Time | Click | What the audience sees | Rough edges to avoid |
|---|---|---|---|---|
| 11 | 1:15 | **Entity switcher → Walkthrough Test 2 → Report.** Leave Month on **Dec 2025**; Budget picks **"Budget 2025 (stretch)"** by itself. Scroll through. | **Header:** "Walkthrough Test 2 / Monthly report: Dec 2025", "Generated … by [email]", and "Actuals through Dec 2025, last synced …. Balances through Dec 2025." **1. Headlines:** Revenue €65,024.39, Net profit €4,099.18, Cash balance **€95,400.00**, Runway **7.8** (€12,150.00/month net cash burn, includes loans and owner funding). **2. Budget against actual, year to date** (the same figures as Compare): Revenue budget **€768,038.11** against actual **€724,564.25**, **−€43,473.86, −5.7%, ▼ Unfavourable**. Payroll **−€8,375.17, ▲ Favourable**. Marketing **+€2,697.78 (+17.6%), ▼ Unfavourable**. Net profit €121,493.67 budget against €94,279.19 actual (−€27,214.48, −22.4%, unfavourable). **3. Trend:** revenue and net profit Jan–Dec 2025, with the budget dashed. Month-end cash bars for Aug–Dec 2025: **€133,562.08, €131,850.00, €121,095.37, €108,180.12, €95,400.00**, with the runway beside them. **4. Scenarios:** "No scenarios saved for this budget." **5. Data quality:** "None"; excluded 3 accounts, €7,786.12 Dr; and the fixed line about not being audited. | Net profit on Test 2 is €4,099.18, not Test 1's €4,095.00, because 9900 is excluded there (see "Re-running steps 4 and 5"). Say that Marketing came in over a budget that was cut by 15%. |
| 12 | 0:45 | **Print / save as PDF.** In the browser's print dialog choose **Save as PDF**, **A4**, **Portrait**, default margins, then **Save**. | A black-on-white A4 report of about two pages: no sidebar, menu or pickers; the tables at a small type size; the charts included. | Check the PDF once before the demo. You are checking it yourself; the print rules were measured, not seen as a PDF (`docs/reports/P3-REPORT.md`). |

### Do not click (Report)

- **Download CSV** during the demo. It works (the same file as Compare's export), but it opens a
  download prompt.
- **A month before 2025.** There are no actuals, so most figures are "—". Correct, but dull.
- **The Report page on production** before phase-3 is merged. It is still the placeholder there.

