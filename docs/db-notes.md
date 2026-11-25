# Database notes (things the schema depends on that are easy to miss)

## Visibility of line_map depends on the connections read policy (since 0003)

- **`fpa.line_map` has no `entity_id`.** Since 0003 its read policy is:

  ```
  connection_id IN (SELECT c.id FROM fpa.connections c
                    WHERE c.entity_id = ANY (ARRAY(SELECT fpa.my_entity_ids('viewer'))))
  ```

- **The subquery on `fpa.connections` runs under that table's own row security** (`connections_read`,
  viewer or above). So who can read a line-map row depends on two policies:
  - `line_map_read` itself;
  - **`connections_read`**.
- **Today both say the same thing:** an active member at viewer or above. The 0003 test proved it for
  all 9 identities, with identical rows under the old and new rules.
- **If `connections_read` is ever changed, `line_map` visibility changes with it.** Narrowing it, for
  example to owners only, would hide line maps from editors and viewers. Widening it would not widen
  line maps, because the `my_entity_ids` filter still applies.
- **Rule:** any migration that touches `connections_read` must re-run the identity matrix for
  `line_map`. That matrix is section 11 of `db/tests/0003_phase1.test.sql`: same rows, old rule versus
  new.
- Applies to: 0003 (applied 25 Nov 2026). See also `docs/ui-rules.md` §1.

## Read policies that use my_entity_ids

- `actuals_monthly_read` and `line_map_read` call `fpa.my_entity_ids('viewer')` once per query.
- Any future table with large row counts should use the same pattern rather than a per-row helper
  call.
- **Measured:** per-row checks took more than 8 seconds at 44,000 rows. With the helper, the slowest
  call was 1.3 seconds at 284,000 rows (`docs/reports/P1-A-timing.md`).
