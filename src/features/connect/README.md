# connect

Where the actuals come from (Phase 1).

| File | What it is |
|---|---|
| `ConnectPage.tsx` | Connect › Import: the CSV connection (owners add it), its status and recent imports, the import |
| `ImportWizard.tsx` | The import steps: choose a file, match columns, two questions, check, import, result (1B) |
| `MapPage.tsx` | Connect › Map accounts: plan line per account, unmapped first, suggestions, save (1C) |
| `mapping.ts` | The mapping screen's rules as pure functions ("complete", excluded count and total) |
| `api.ts` | Data access through `src/lib/db.ts`; long lists paged with `pageAll` |
| `format.ts` | Month, Dr/Cr and date display |

The checks on the file itself are pure functions in `src/engine` (`csv.ts`, `actualsImport.ts`,
`lineSuggest.ts`). The server (`fpa.import_actuals`) checks every row again.

The template is made in the browser. The sample files are in `public/samples/` and come from
`node scripts/make-actuals-csv.mjs sample public/samples`.
