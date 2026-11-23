# Design provenance

These files are copied, not imported. Klaro, Ledgrly and Trinity now each hold a copy; at three
copies a shared package is worth scheduling (it is on the backlog). Nothing in Ledgrly or Trinity
was changed.

Sources:
- Ledgrly: `finflow-deploy` at commit `51c5f24` (18 Nov 2026).
- Trinity: `trinity-bookings` at commit `627d25c` (20 Nov 2026). Its `src/design` was last
  changed in `b546035`, which copied it from Ledgrly `51c5f24`; see Trinity's own PROVENANCE.md.

| File here | Source | Changes in Klaro |
|---|---|---|
| `tokens.css` | Trinity `src/design/tokens.css`, from Ledgrly `src/App.jsx` 324 (fonts) and 326-346 (`:root`) | None. As in Trinity, `--white` and `--surface-1` are not copied. |
| `base.css` | Trinity `src/design/base.css`, from Ledgrly `src/App.jsx` 325-592 (reset, card, pill, `.gl-table`, `.f-*`, `.btn*`) | None. |
| `downloadCSV.ts` (+ test) | Trinity `src/design/downloadCSV.ts`, from Ledgrly `src/App.jsx` 283-290 | None. |
| `ExportDropdown.tsx` | Trinity `src/design/ExportDropdown.tsx`, from Ledgrly `src/App.jsx` 292-321 | None. |
