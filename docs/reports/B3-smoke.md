# B3 step 3: smoke test after `fpa` was exposed

23 Nov 2026, 14:57 UTC, against https://ihrbvnpwdxdppsnqlsfb.supabase.co. Run after you added
`fpa` to Exposed schemas.

Each request was sent twice: once with the legacy anon key and once with the publishable key. Both
are the project's public keys; neither appears in this file. All requests are reads except F7, an
RPC call refused before it runs. Nothing was written. The script is `scripts/b3-smoke.mjs`
(keys from the K_ANON and K_PUB environment variables; it never prints them). N1–N4 were single `curl` requests with the publishable key.

## Result

| Criterion | Result |
|---|---|
| Anon gets **no rows** from `fpa` | **PASS.** Every table and RPC request is refused: HTTP 401, `42501` "permission denied for schema fpa". |
| Anon gets **no table names** from `fpa` | **FAIL, needs your decision.** A misspelt name gets PostgREST's hint naming the real table or function (F5, N1–N3). The status code also differs: an existing table gives 401, a missing one 404. Either way, names can be found by guessing. No rows or columns are revealed. |
| The `public` schema behaves as before | **PASS, with a caveat.** Anon reads return `200 []`, with RLS still hiding every row, with or without the profile header. The same name hints already happen in `public` (N4). **Caveat:** I didn't capture a pre-exposure baseline, so "as before" is checked against the expected behaviour (the Ledgrly anon check expects 0 rows), not against a recorded earlier response. |

## Exact responses

Both keys gave the same status and body on every row, except F6 (the error text is noted below).

| # | Request (profile header) | Status | Body |
|---|---|---|---|
| F1 | `GET /rest/v1/entities?select=*` (fpa) | 401, `proxy-status: PostgREST; error=42501` | `{"code":"42501","details":null,"hint":null,"message":"permission denied for schema fpa"}` |
| F2 | `GET /rest/v1/schema_migrations?select=*` (fpa) | 401, 42501 | same as F1 |
| F3 | `GET /rest/v1/vat_rules?select=*` (fpa) | 401, 42501 | same as F1 |
| F4 | `GET /rest/v1/plan_versions?select=id,locked_by` (fpa) | 401, 42501 | same as F1 |
| F5 | `GET /rest/v1/entitie?select=*` (fpa, misspelt) | 404, `error=PGRST205` | `{"code":"PGRST205","details":null,"hint":"Perhaps you meant the table 'fpa.entities'","message":"Could not find the table 'fpa.entitie' in the schema cache"}` |
| F6 | `GET /rest/v1/` (fpa, OpenAPI root) | 401 | anon key: `{"message":"Invalid API key","hint":"Only the `service_role` API key can be used for this endpoint."}`; publishable key: `{"message":"Secret API key required","hint":"Only secret API keys can be used for this endpoint."}`. No schema listing. |
| F7 | `POST /rest/v1/rpc/create_entity` (fpa) | 401, 42501 | same as F1 (refused before the function runs; nothing created) |
| F8 | `HEAD /rest/v1/entities?select=*` (fpa) | 401, 42501 | (no body) |
| N1 | `GET /rest/v1/plan_version` (fpa, misspelt) | 404, PGRST205 | `{"code":"PGRST205","details":null,"hint":"Perhaps you meant the table 'fpa.plan_versions'","message":"Could not find the table 'fpa.plan_version' in the schema cache"}` |
| N2 | `GET /rest/v1/drivers_x` (fpa, misspelt) | 404, PGRST205 | `…"hint":"Perhaps you meant the table 'fpa.drivers'"…` |
| N3 | `GET /rest/v1/rpc/create_entit` (fpa, misspelt) | 404, PGRST202 | `{"code":"PGRST202","details":"Searched for the function fpa.create_entit without parameters, but no matches were found in the schema cache.","hint":"Perhaps you meant to call the function fpa.create_entity","message":"Could not find the function fpa.create_entit without parameters in the schema cache"}` |
| P1 | `GET /rest/v1/companies?select=id&limit=1` (public) | 200, `content-range: */*`, `content-profile: public` | `[]` |
| P2 | `GET /rest/v1/chart_of_accounts?select=id&limit=1` (public) | 200, `content-range: */*`, `content-profile: public` | `[]` |
| P3 | `GET /rest/v1/companies?select=id&limit=1` (no profile header) | 200, `content-profile: public` | `[]` (the default schema is still `public`) |
| P4 | `GET /rest/v1/` (public, OpenAPI root) | 401 | the same key-type refusal as F6 |
| N4 | `GET /rest/v1/companie` (public, misspelt) | 404, PGRST205 | `…"hint":"Perhaps you meant the table 'public.companies'"…`: the same hint behaviour already exists in Ledgrly's `public` |

## What the FAIL means

- **Where it comes from:** PostgREST builds its schema cache with its own login role, not the
  caller's, and suggests near matches when a name is wrong. Anon's lack of USAGE on `fpa` stops
  every read and call, but not the hint. The 401-versus-404 difference also shows whether a name
  exists.
- **What can't fix it:** no grant or policy in `fpa` changes this.
- **Scope:** it already applies to every Ledgrly table and function in `public`.
- **What it reveals:** names of tables and functions only, found by guessing close spellings. No
  rows, no column values, and nothing runs.

Options (your call; I have changed nothing):

1. **Accept it.** It is the same exposure `public` already has. Record it as a known limitation.
2. **Remove `fpa` from Exposed schemas again.** Klaro would then reach `fpa` only through server
   code. That needs a service_role grant design in a later batch, and it changes how B4 talks to
   the database.
3. **Keep it exposed and rename nothing for now.** Revisit if Supabase or PostgREST adds a
   setting to turn hints off. I'm not aware of one today.

B4 not started.
