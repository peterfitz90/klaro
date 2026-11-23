# Known limitations

Accepted limitations of Klaro's current design, each with the evidence and what it means.
New entries go at the end, with a date and the decision.

## 1. The API reveals table and function names in `fpa` to anyone with the public key

**Accepted by Peter, 23 Nov 2026 (B3).** Evidence: `docs/reports/B3-smoke.md`.

Supabase's REST API (PostgREST) builds its schema cache as its own login role, not the caller's.
Since `fpa` was added to Exposed schemas, a caller holding only the public (anon or publishable)
key can learn the names of tables and functions in `fpa` in two ways:

- **Spelling hints.** A request for a name that is nearly right gets a 404 whose hint names the real
  object, for example:
  - `GET /rest/v1/entitie` (Accept-Profile: fpa) gives 404 `PGRST205` with
    `"hint":"Perhaps you meant the table 'fpa.entities'"`.
  - `GET /rest/v1/rpc/create_entit` gives 404 `PGRST202` with
    `"hint":"Perhaps you meant to call the function fpa.create_entity"`.
- **401 versus 404.** A request for a table that exists gives 401 `42501` ("permission denied for
  schema fpa"); a name that does not exist gives 404. The status alone shows whether a name exists.

What is **not** revealed: no rows, no column values, no column list, no function results. Every read,
`HEAD` and RPC call to `fpa` with the public key is refused (anon has no USAGE on the schema), and the
OpenAPI listing at `/rest/v1/` is refused to public keys.

The same behaviour already applies to Ledgrly's `public` schema (`/companie` hints
`public.companies`). No grant or policy can turn it off; PostgREST has no setting for it today.

**Consequence: names are public.** Never put a client name or a sensitive term in a table, column,
function, schema, index, constraint, trigger or policy name. See the repo rule in `CLAUDE.md`.
Revisit if Supabase or PostgREST adds a way to turn the hints off.
