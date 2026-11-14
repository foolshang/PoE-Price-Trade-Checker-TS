# PoE Price & Trade Checker

TypeScript + Electron rewrite of the Python PoE Price & Trade Checker and Filter Generator.
**v1.0.0 was released on 2026-10-21** (both programs and the web page); the Python original is no longer the program to use, it only gets bug fixes.

| | What | Where |
|---|---|---|
| `apps/checker` | PoE Price & Trade Checker (Windows): F5 trade search from the item under the mouse, F4 skill reference, settings (F8), tray, NeverSink notices, built-in Filter Generator page | Releases of this repository |
| `apps/filtergen` | PoE1 & PoE2 Filter Generator (Windows) | Releases of `foolshang/PoE-Filter-Generator` |
| `apps/web` | the Filter Generator as a web page (the same code, no Pyodide) | https://foolshang.github.io/PoE-Filter-Generator/ (the old page: `/legacy/`) |
| `packages/core` | the logic (filter engine, item parser, stat matching, hub clients); no DOM, no Node-only imports | |
| `packages/ui`, `packages/node`, `packages/desktop` | the shared page, Node adapters, the desktop host shared by both Electron apps | |

Changes per program: `apps/checker/CHANGELOG.md`, `apps/filtergen/CHANGELOG.md`, `apps/web/CHANGELOG.md`. Working history: `history.md`.

Documents: `docs/PLAN.md` (structure, decisions, phase table), `docs/PHASE1.md` - `docs/PHASE5.md` (what each phase built and how it was tested; PHASE5 Addendum 11 = the release),
`docs/CONVERSION.md` (file by file from the Python original), `docs/DEPLOY.md` (web deploy and rollback), `docs/archive/` (drafts from before the release).
`CLAUDE.md` holds the working rules (Thai).

Commands: `npm test` (unit + parity, about 2 minutes), `npm run typecheck`, `npm run lint`; the rest is listed in `CLAUDE.md`.
Licence: MIT.
