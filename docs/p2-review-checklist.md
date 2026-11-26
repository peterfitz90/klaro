# Phase 2 review checklist (for Peter, on klaro-preview.ledgrly.ie)

Tick each one yourself. The "checked by" column says what I (Claude) checked, and where; nothing here
is marked as done by you.

| # | Check | How | Checked by Claude |
|---|---|---|---|
| 1 | The balances sample imports | Connect → "Month-end balances" → `sample-balances.csv` → Check → Import 36 balances → "Balances through Dec 2025" | Demo mode: full import. Preview: the check only (not imported, as instructed) |
| 2 | **A balances file with a month that fails** is refused, and nothing is sent | Same steps with `sample-balances-broken.csv` (June written as "2025-13"): 3 problems on lines 17–19, Import disabled | Preview and demo mode; unit test |
| 3 | Not set up shows "—" with "Map your bank accounts to Cash and bank", never 0.00 or n/a | After the import, before mapping: look at the Plan tiles | Unit and screen tests. Not seen live, because no balances are loaded |
| 4 | "Incomplete: N balance accounts unmapped" on the Cash tile | Map only the two bank accounts and leave 1100 unmapped: the Cash tile says "Incomplete: 1 balance account unmapped" | Unit and screen tests |
| 5 | After mapping: Cash €95,400.00, Runway 7.8, €12,150.00/month net cash burn (includes loans and owner funding) | Map accounts → balance section → Use all 3 suggestions → Save → Plan | Demo mode (exact figures); unit test; fixture shared with the 0004 test |
| 6 | The import preview warns, without blocking, when a Cash and bank account has no row in a month | After step 5, import a balances file that has no 1220 row for one month: "Account 1220 has no row for … its balance will count as 0." Import still enabled | Screen test only |
| 7 | Cash and bank is not offered for P&L accounts | Map accounts: a P&L account's dropdown has no "Cash and bank" | Preview and demo mode; screen test |
| 8 | Budget save is all-or-nothing | Plan → edit two cells → Save. To see the failure, lock the budget in another tab, then save: "Nothing was saved. This budget is locked…" and the edits stay | Demo mode (success); screen tests (refused, timeout, locked) |
| 9 | Compare unchanged: no Cash and bank line; excluded total €6,936.49 Dr (Walkthrough Test 1) | Compare, Dec 2025 | Preview |
| 10 | Phase 1 figures unchanged: Revenue €65,024.39, Net profit €4,095.00 (Walkthrough Test 1, Dec 2025) | Plan tiles | Preview, and the database after the apply |
| 11 | Phone width | Plan and Connect at about 390px: no sideways scroll; the tiles sit two by two | Demo mode, in a 390px frame |
