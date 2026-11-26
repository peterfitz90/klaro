# P4-SEAN: Sean added as a viewer on Walkthrough Test 2

Date: 26 Nov 2026. One write, approved by you. No other row, entity or grant was changed, and nothing
was deleted. finflow-deploy (Ledgrly) was only read.

## The row

| Field | Value |
|---|---|
| `fpa.entity_members.id` | **`f9e44715-41f4-47e6-abf9-8c1ea2894309`** |
| entity_id | `7b22a8be-23c1-4b87-9605-004f33a4f94d` (Walkthrough Test 2) |
| clerk_user_id | `user_3EjTC9vKro1MGFbiAAJw8uYnUgW` |
| role | `viewer` |
| is_active | true (the default) |
| created_at | 2026-11-26 14:55:11 UTC |

**Inserted as the database admin through the connector** (`fpa.add_member` checks the caller's own
JWT as an owner). The insert was guarded to run only if the entity exists with exactly that name.

## How the Clerk user id was found

1. **I searched the shared database first, read-only.** No Ledgrly table stores an email next to a
   Clerk user id:
   - `companies`, `user_company_access` and `expenses` hold Clerk ids but no emails;
   - the pending business-owner invites table holds the invitee's email but only the inviter's id.

   The email appeared nowhere: not in the pending invites, not in Supabase Auth's users or
   identities, and not in customers. **So I stopped and asked, without guessing.**
2. **You supplied the id from the Clerk dashboard.** I did not use Clerk's secret key.
3. **Cross-check, read-only:** this id owns one Ledgrly company (`public.companies.clerk_user_id`).
   That fits him having a Ledgrly login. It has no `user_company_access` rows, which is normal for a
   company owner.

## Checks before the insert (read-only)

| Check | Result |
|---|---|
| The id matches `^user_[A-Za-z0-9]{1,64}$` (`fpa.add_member`'s rule and the table's CHECK) | yes |
| The entity exists and its name is exactly "Walkthrough Test 2" | yes |
| Existing `fpa.entity_members` rows for this id, on Test 2 or any entity | 0 |
| Members of Test 2 before the insert | 1 (the owner, active) |
| The table's constraints (role in owner/editor/viewer; unique (entity, user); the id pattern) | satisfied |

## Checks after the insert

**Read-back:** the row above, exactly. It is the only `fpa.entity_members` row with his id. Test 2
now has 2 members.

**His access**, tested in a rolled-back transaction as `authenticated`, with his id as `sub` in the
JWT claims:

| Check | Result |
|---|---|
| Entities he sees | **Walkthrough Test 2 only** |
| test 1, Walkthrough Test 1, Walkthrough Test 3, by name | **0 visible** (Walkthrough Test 3 doesn't exist yet) |
| `variance` on Walkthrough Test 1 | 0 rows |
| Test 2 actuals | 193 rows (all the actuals he can see) |
| Test 2 balances | 36 rows (all the balances he can see) |
| Budgets he sees | "Budget 2025 (stretch)" and "Review budget 2026", Test 2's two |
| Lines on "Budget 2025 (stretch)" | 96 |
| Scenarios he sees | Test 2's only: Base (×2, one per budget), Upside, Downside, Hiring plan |
| `variance`, Dec 2025 Net profit | €4,099.18 (the same as the app) |
| `cash_position`, Dec 2025 cash | €95,400.00 |
| **Write:** `save_budget_lines` on the stretch budget | **refused**, PT403 "You need editor or owner access to this budget." |
| **Write:** `import_balances` into Test 2 | **refused**, PT403 "You need editor or owner access to this entity to import balances." |
| **Write:** `UPDATE fpa.driver_values` (one of Test 2's scenario values) | **no effect: 0 rows.** Row security lets a viewer see the row but not update it |
| **Write:** `UPDATE fpa.plan_lines` (one stretch line) | **no effect: 0 rows** (row security) |
| **Write:** `fpa.add_member`, adding himself as owner | **refused**, PT403 "Only an owner can add members." |

## Anything odd

- **The two direct updates aren't errors; they change nothing.** That is how row security works for
  a viewer: the row is filtered out of the update, so 0 rows change. The functions refuse with a
  clear PT403.
- **Sean will see Walkthrough Test 2 only,** including the demo budget "Budget 2025 (stretch)" and its
  scenarios. As a viewer, the screens are read-only for him:
  - the Scenarios panel shows "You can see the scenarios";
  - the budget grid has no Save;
  - Connect says importing needs editor access.
- **Nothing in Ledgrly was changed;** it was only read.
