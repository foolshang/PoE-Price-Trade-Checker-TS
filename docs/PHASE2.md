# Phase 2 - the web page on the TypeScript core (no Pyodide)

Status: built and tested here; waiting for Winai's test on localhost. **Not deployed** (`/ts/` only when Winai orders it and
`RELEASE_TOKEN` exists). No tag.

## What was built

| Where | What |
|---|---|
| `packages/ui` | All the UI as TypeScript: `dom.ts` (`h()`, helpers), `storage.ts` (localStorage + IndexedDB), `state.ts`, `data.ts` (hub, NeverSink, names), `files.ts` (sounds, folder handles, zip), `api.ts` (`WebApi`, replaces `glue.py`), `style_editor.ts`, `tab_ns.ts`, `tab_wl.ts`, `open_filter.ts`, `shell.ts`, `app.ts` (`boot`), `style.css`. Phase 3 (Electron) reuses it. |
| `apps/web` | Vite app: `index.html`, `src/main.ts`, `vite.config.ts` (`base "./"`, sub-path safe), `public/data/trade_names_*.json` (snapshot). |
| `tests/web` | `harness.mjs`, `ui.mjs` (port of the original's Playwright suite), `parity.e2e.ts`, `compat.e2e.ts`, `live.mjs`, `perf.mjs`. |
| `tools` | `refresh-names*.ts` (`npm run names:refresh`), `unused-exports.mjs` (dead-code finder). |

`WebApi` returns typed objects (the Python glue returned JSON strings). The DOM keeps the original's ids and classes, which is
why `ui.mjs` needed few edits. `window.PFG` (api, FS, hooks, sounds, store, state) is exposed for tests.

## Compatibility with the old page (kept)

localStorage `poeFilterGen.cfg`, `poeFilterGen.game`, NeverSink cache keys `poeFilterGen.ns.*`; IndexedDB `poe-filter-gen` v2
(`sounds`, `handles`; handle key = game); embedded `app` = `web-<version>`. Proven by driving the old page and then the new
page on the same browser profile (`compat.e2e.ts`).

## Run it

- `npm run web:local` - builds with `--mode localhost` and serves `http://127.0.0.1:4173/` (preview). The hub only allows
  the origin `https://foolshang.github.io`, so on localhost the server proxies `/__hub` to the hub bucket
  (`apps/web/.env.localhost` sets `VITE_HUB_BASE=/__hub`). GitHub (API + raw NeverSink files) is called directly.
- `npm run web:dev` - Vite dev server on `http://localhost:5173/` (same proxy).
- `npm run web:build` - production build to `apps/web/dist` (hub URL = the bucket; works only from the Pages origin).

## Tested here (all pass)

| Test | Result |
|---|---|
| `npm test` (unit + parity by sha256, 1,875 tests) | pass |
| `tsc` strict, eslint (`packages apps tests tools`) | clean |
| `tests/web/ui.mjs` (port of the original's suite, incl. 360 px) | all checks ok |
| `npm run test:e2e`: `parity.e2e.ts` (tier tab x2 games, whitelist tab x2 games byte-equal to the original's goldens; 24 random whitelist configs equal to the core) + `compat.e2e.ts` (old state) | 39 / 39 |
| `live.mjs pages` / `local` (real hub + GitHub from the Pages origin / via the proxy) | pass, no console or network errors |
| `perf.mjs` vs the Pyodide page | usable at 132 ms vs 1,988 ms; lists loaded 241 vs 1,999 ms; whitelist generate 101 vs 202 ms; scroll: max frame 12 ms, 0 frames over 34 ms |
| `npm run names:refresh` against GGG | 7,685 / 4,363 names, byte-identical to the shipped snapshot |

## Dead code removed (rule 6c) - phase-1 core audit

Found with `tools/unused-exports.mjs` and by following `GEAR_LISTED` (always empty: equipment is never listed block by block,
every gear block is copied from NeverSink). The Python original keeps this code; it was left alone there.

- The whole "listed gear" path: `GEAR_LISTED`, `listedGearGroups`, `gearTiers`, `gearBlockTiers`, `legacyGearTier`,
  `gearBlockItems`, `gearBlocks`, the `listed` entries of `gearSequence` (now returns the copied blocks only), `blockLabel`
  with its helper tables, `NOT_CONDITION`; in `wl_model`: `_gearItems`, `isGear` branches in rows / setters / categories,
  the legacy fold into `gear:*` category tiers; in `wl_import`: the gear loop with `max(set(...))` tier pick, the `missing`
  note, `condKey`, `NEW_GEAR_GROUPS`; `gear_tiers` / `block_tiers` of the build result.
- Other unused exports: `rstripChars`, `isList`, `AUDIO_EXTENSIONS`, `COLOR_RGB`, `SPECIAL_BASE`, `BASE_PREFIX`,
  `LEGACY_RARITY_KEY`, `LEVELS` / `DEFAULT_STRICTNESS` / `filename` of `neversink_source`, `tierLabel`, `GEAR_PREFIX`
  (`wl_model`), `ladderNames`, `hubChaosValue` (price-mode helper), `soundBlockCounts` (moved to `packages/core/test/sound_counts.ts`).
- Kept on purpose: persisted keys (`wl_block_tier_*`, `wl_gear_tier_*`: old settings are still read, dropped with a note);
  `loadWhitelistInputs`, `generateFilter`, `checkNeversinkUpdate`, `neversinkUpdateMessage`, `rememberResult`, `NodeFs`, `NodeHttp`
  (the desktop app of phase 3 calls them; they are unused by the web only).
- Tests: the vacuous `gearBlocks` test, the `blockLabel` test and the chaos-value test were removed with their code. Parity
  cases for removed functions were dropped from `tools/parity/cases.py`; goldens regenerated (`parity:regen`), the old repo's
  `git status` was clean before and after.

## Bugs not copied

- `max(set(tiers), key=tiers.count)` in the original's `wl_import` has a hash-order tie-break; the code was dead (see above) and is gone.
- Downloads are CRLF exactly once (`toCrlf`; `\r\r\n` is asserted absent in the e2e tests).

## Needs Winai

See the phase report: real-data test on localhost in Chrome / Edge (folder, open old filter, generate, sounds), Firefox
download path, settings carried over from the old page, and a look at the look & feel.
