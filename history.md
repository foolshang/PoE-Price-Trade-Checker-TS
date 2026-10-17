# PoE Price & Trade Checker (TypeScript) - History

> Entry format: date - summary - files touched - status / open problems.
> Newest entry on top.

---

## 2026-10-17 (4) - web deploy workflows; first real deploy stopped (403 on push)

- Added `.github/workflows/deploy-web.yml` (manual; first run moves the old page to `/legacy/`, then replaces the root web
  files, nothing else), `rollback-web.yml` (manual, `confirm=ROLLBACK`), `docs/DEPLOY.md`.
- Dry run on Actions: passed (names refreshed 7,685 / 4,363, version check ok, legacy move and file lists as planned).
- Real run: build ok, clone ok, **push to `foolshang/PoE-Filter-Generator` gh-pages refused: 403 "Permission ... denied to
  foolshang"** - `RELEASE_TOKEN` of this repo cannot write there (scope / repo access / expiry; the value was never read).
  gh-pages is unchanged (25 files, identical list before and after). Waiting for Winai to fix the token.
- Clash found: the original's `deploy-web.yml` force-pushes a single commit to gh-pages on every `v*` tag (see docs/DEPLOY.md).

---

## 2026-10-17 (3) - phase 2: web page on the TS core, no Pyodide (committed, no tag, not deployed)

- `packages/ui` (all UI, reused by Electron in phase 3), `apps/web` (Vite), `tests/web`, `tools/refresh-names*.ts`
  (`npm run names:refresh`), version `1.0.0-beta.1`. Details, run commands and results: `docs/PHASE2.md`.
- Tested here: unit + parity 1,875 tests, tsc strict, eslint, `ui.mjs` (all checks), e2e 39/39 (byte-equal to the
  original's goldens for 2 games x 2 tabs; old-state compatibility), real hub + GitHub from the Pages origin, perf
  (usable 132 ms vs 1,988 ms for the Pyodide page).
- Dead code of the phase-1 core removed (rule 6c): the whole "listed gear" path (`GEAR_LISTED` is always empty),
  including the `max(set(...))` tier pick in `wl_import`, plus 17 unused exports; list in `docs/PHASE2.md`. Parity cases
  for removed functions dropped, goldens regenerated; all tests pass.
- Not done on purpose: no GitHub Pages deploy, no tag. Open: Winai's test on localhost (`npm run web:local`).

---

## 2026-10-17 (2) - phase 1 done: filter core in TypeScript, byte parity with the original (not committed to a release, no tag)

- `packages/core`: filter_style, filter_gen, filter_core, filter_whitelist, wl_embed, wl_model, wl_import, wl_session,
  filter_service, filter_output, hub_client, neversink_source, trade_names (+ `py.ts` Python-semantics helpers);
  `packages/node`: `NodeFs`, `NodeHttp`. All in strict TypeScript 6.0.3, eslint clean.
- Parity: 1,491 cases run on the Python original (v0.13.5, c9c5752, read only) and on the TS core; every text compared
  by sha256 -> all equal. `npm run parity:check` re-runs the original and reproduces the committed goldens.
- Tests: 1,916 pass (1,499 parity incl. bookkeeping, 417 converted unit tests); the golden files of the original
  (filter_service_golden, golden_open_messages) are reused as they are.
- Findings in the original (docs/PHASE1.md F1-F3): CRLF base text written in text mode gives doubled CRs on Windows; a
  tie-break that depends on the string hash seed (dead code); negative index of the NeverSink level list.
- Left for later phases: Tk-only tests (replaced by Playwright), web glue/parity tests (phase 2), parser/badge/meta tests (phase 4).
- The original folder and repo were not modified (checked with `git status` before and after every golden run).

## 2026-10-17 - phase 1 started; decisions of Winai on the phase 0 questions

- Decisions: (1) npm workspaces; (2) `packages/ui` and `packages/node` accepted; (3) two exes; (4) `v1.0.0-beta.N` -> `v1.0.0`;
  (5) web staged at `/ts/`, Winai adds `RELEASE_TOKEN` to this repo himself when the release phase comes; (6) config in
  `%LOCALAPPDATA%\PoePriceTradeTS`, imported once from the original, the original's files are never written; (7) MIT licence
  (`LICENSE`); (8) **the EE2 / APT fork plan is cancelled** - F5 of the new program is our own (the original's history is not
  edited); (9) branch `master`; (10) Winai tells me when the original gets a bug fix so the goldens are refreshed.
- Tooling: TypeScript **6.0.3**, not 7.0.2: `typescript-eslint` 8.71.2 declares peer `typescript >=4.8.4 <6.1.0` (npm ERESOLVE
  with 7.x); vitest 5.0.5 runs with 7.x but lint is wanted, so the whole repo is on 6.0.3 until typescript-eslint supports 7.

## 2026-10-17 - phase 0: skeleton, survey of the Python original, plan (nothing converted)

- Created `D:\Projects\PoE_Price-Trade_Checker_TS` and the public repo `foolshang/PoE-Price-Trade-Checker-TS`
  ("PoE Price & Trade Checker (TypeScript)"). Skeleton only: `CLAUDE.md`, `docs/PLAN.md`, `docs/CONVERSION.md`,
  `README.md`, root `package.json` (workspaces), `.gitignore`, `.gitattributes`, empty `packages/core`,
  `apps/{checker,filtergen,web}`. No dependencies installed, no tag.
- Read (read only) the original at v0.13.5 (master c9c5752): CLAUDE.md, history.md, every file of `poe_price_trade/`,
  `web/`, `tools/`, `tests/`, the release / deploy workflows, and the standing rules kept in Winai's memory notes.
  The original folder and repo were not touched.
- Findings worth keeping: embedded-config zlib bytes only match Python with pako 2.1.0 (`node:zlib` and fflate differ,
  measured); web origin data (localStorage key `poeFilterGen.cfg`, IndexedDB `poe-filter-gen` v2) must stay compatible;
  the original drops unknown `config.json` keys on save, so two apps should not share one file.
- Status: waiting for Winai's decisions (docs/PLAN.md section F). Next: phase 1 after approval.
