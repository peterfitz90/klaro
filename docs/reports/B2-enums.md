# B2: allowed values (CHECK constraints in 0001)

Copied exactly from `db/migrations/0001_fpa_schema.sql`
(sha-256 `afacaac26393543dd4ce1880f28e140dc119fcc4d5a2be828ed6e09806e996c6`). The value strings are
case-sensitive, and any other value is refused with error 23514. Changing a list once 0001 is applied
needs a new numbered migration.

## The four you asked for

| Column | Allowed values (exact) | Default | NULL allowed? |
|---|---|---|---|
| `fpa.entities.vat_scheme` | `standard`, `cash_basis`, `flat_rate`, `not_registered` | `standard` | No |
| `fpa.vat_rules.filing_frequency` | `monthly`, `bi_monthly`, `quarterly`, `four_monthly`, `six_monthly`, `annual` | none | Yes: NULL on a rate row. A filing-rule row must have it, together with `due_day_rule`. |
| `fpa.drivers.unit` | `currency`, `percent`, `count`, `months`, `days`, `ratio` | none | No |
| `fpa.drivers.kind` | `input`, `calculated` | none | No |

Notes for your decision:
- **`vat_scheme`**:
  - The list doesn't distinguish Irish cash basis ("moneys received") from UK cash accounting; both are `cash_basis`.
  - `flat_rate` is a UK scheme; nothing stops it being chosen for an IE entity.
  - Add, remove or rename values before apply if you want.
- **`filing_frequency`**: these are the cycles I believe exist across IE and UK. `four_monthly` and `six_monthly` are included for Irish small-trader cycles, and need your confirmation.
- **`drivers.unit`**: `currency` means the entity's own currency (EUR or GBP); no currency code is stored on the driver.

## The other enumerations, for completeness

| Column | Allowed values (exact) | Default |
|---|---|---|
| `fpa.entities.jurisdiction` | `IE`, `UK` | none |
| `fpa.entities.currency` | `EUR`, `GBP` | none |
| `fpa.entities.vat_cycle_anchor` | 1 to 12 (month), or NULL (not set) | NULL |
| `fpa.entity_members.role` | `owner`, `editor`, `viewer` | none |
| `fpa.connections.source_type` | `ledgrly`, `accounting_package`, `mcp`, `csv` | none |
| `fpa.connections.status` | `pending`, `active`, `error`, `disabled`. An owner may only set `pending` or `disabled` (policy). | `pending` |
| `fpa.vat_rules.jurisdiction` | `IE`, `UK` | none |
| `fpa.plan_versions.kind` | `budget`, `forecast` | none |
| `fpa.plan_lines.origin` | `actual` (amount must be NULL), `driver`, `manual` (amount required) | none |
| `fpa.plans.fiscal_year_start` | 1 to 12 (month) | 1 |
| `fpa.plans.horizon_months` | 1 to 60 | 12 |
