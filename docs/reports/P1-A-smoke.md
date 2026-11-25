# P1-A apply and smoke test

25 Nov 2026. **0003 is applied.** Every anonymous call to the seven new functions is refused.

## Apply

| Step | Result |
|---|---|
| 1. Read-only pre-check | Supabase migration history **102**; `fpa.schema_migrations` held only `0001_fpa_schema.sql` (`afacaac2…`); **0** entities; no 0003 objects; 20 functions; 40 policies |
| 2. Apply | `db/out/apply_0003.sql` (sha-256 `02d2c24ab4308aaf…`), sent as plain SQL in one transaction, after your confirmation. `apply_checks_0003.sql` ran before `COMMIT` and passed (any failure would have raised and rolled everything back). Committed at **09:03:33 UTC**, the `applied_at` of the 0003 row |
| 3. Byte-check | `scripts/check-sent.mjs`: the text sent matches `apply_0003.sql` byte for byte (49,171 characters, `02d2c24ab4308aaf`) |

## Read-only checks after the apply (`BEGIN READ ONLY`)

- **The apply checks pass again.** They cover:
  - 16 tables, all with row security;
  - every table, column and function grant;
  - 27 functions;
  - a fixed search_path on all functions;
  - no access for anon, service_role or PUBLIC;
  - no foreign key leaving fpa.
- **`fpa.schema_migrations`:**
  - `0001_fpa_schema.sql`, `afacaac26393543dd4ce1880f28e140dc119fcc4d5a2be828ed6e09806e996c6`, 2026-11-23 14:50:19 UTC;
  - `0003_fpa_actuals_budget_variance.sql`, `5ae7ea50a80405112989d1f6346cae3d3ee446cd293d91686c2ba800b75a91ba`, 2026-11-25 09:03:33 UTC.
- **Supabase migration history: 102** (unchanged).
- **The function bodies match the repo.** I compared the md5 of each `pg_proc.prosrc` with the md5 of the body text in the migration file:

  | Function | md5 (database = repo) |
  |---|---|
  | `account_map` | `eac1d305aeec598ab3dddb55d22d599e` |
  | `create_budget_from_actuals` | `aca1c2a69cbb5d6de56e0f475f88c935` |
  | `import_actuals` | `1eaa34a5dc880ad0e9ff03cbf90254de` |
  | `my_entity_ids` | `1d476671d777d4095281c9b34b462c81` |
  | `set_line_map` | `61d261d6c9b7640bd566d8d6ec71e99f` |
  | `unmapped_accounts` | `da55d23687b8603f7d0ce115efc82fb7` |
  | `variance` | `e2f4425cc5cab847b4e52cf4ccb59a78` |

- **The policies have the new text:**
  - `actuals_monthly_read`: `(entity_id = ANY (ARRAY( SELECT fpa.my_entity_ids('viewer'::text) AS my_entity_ids)))`
  - `line_map_read`: `(connection_id IN ( SELECT c.id FROM fpa.connections c WHERE (c.entity_id = ANY (ARRAY( SELECT fpa.my_entity_ids('viewer'::text) AS my_entity_ids)))))`
- **42 policies, all TO authenticated only.**
- **Data and leftovers:**
  - `fpa.plan_line_defs` holds its 13 seeded rows;
  - 0 entities;
  - no `fpa_test` schema left behind;
  - `plpgsql_check` not installed.

## Anonymous-key smoke test

Run with `scripts/p1a-smoke.mjs`, 25 Nov 2026, about 09:05 UTC.

- **Keys:** the legacy anon key and the publishable key, read from the environment and never printed.
- **Calls:** each call carried well-formed arguments, so a refusal is about access, not input.
- **Expected:** every call refused.

| Function | Legacy anon key | Publishable key |
|---|---|---|
| `import_actuals` | 401 | 401 |
| `set_line_map` | 401 | 401 |
| `account_map` | 401 | 401 |
| `unmapped_accounts` | 401 | 401 |
| `variance` | 401 | 401 |
| `create_budget_from_actuals` | 401 | 401 |
| `my_entity_ids` | 401 | 401 |

- **Every response body was the same:**
  `{"code":"42501","details":null,"hint":null,"message":"permission denied for schema fpa"}`
- **Result: 14 of 14 refused.** No function ran.
- **Control:** `GET /rest/v1/companies?select=id&limit=1` on `public` with the publishable key returned
  **200**, with a 2-byte body (`[]`). That is the same as in the B3 smoke test, so public behaviour is
  unchanged.

## Not done here

The signed-in browser test belongs to the 1C review stop, as do a real large-file import through the
Supabase gateway (`docs/p1c-review-checklist.md`) and the preview hostname.
