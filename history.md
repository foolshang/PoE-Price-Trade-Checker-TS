# PoE Price & Trade Checker (TypeScript) - History

> Entry format: date - summary - files touched - status / open problems.
> Newest entry on top.

---

## 2026-10-18 (8) - beta.15: update system of the Checker, red dot + details, About (both programs), tray for the Filter Generator (committed, no tag, no release)

- **Checker updates (new `ManagedUpdater` in `@poe/desktop`)**: check at start + every 24 h (with or without automatic update; a down net / bad feed is only a
  log line); F8 option `auto_update` (default ON: a newer version is downloaded in the background; OFF: only announced, no download). Never installed unless the
  player chooses: "update now" (download if needed -> close -> install -> start the new version) or "update when the program is closed" (the real exit, not the X
  that goes to the tray; cancellable). A failed download shows the reason + "try again". The zip copy: the button opens the download page. A "check for updates"
  button exists only without automatic update. The Checker's `publish` now points to its own public repo `foolshang/PoE-Price-Trade-Checker-TS` (B0 answered).
  The Filter Generator keeps the beta.13 `AppUpdater` (banner) untouched (only `notes` added to its state so its About can show the release text).
- **Red dot (Discord style)**: one "something new" flag for a newer version and for the NeverSink notice: overlay icon on the taskbar button + red dot on the tray icon;
  opening the program (tray / taskbar / Show = the window gets the focus) shows a details window with everything that waited (version + release text, NeverSink message,
  with the update buttons inside) and clears the dot. If the window is in front when the news arrives there is no dot.
- **About** (both programs; Checker after Refresh Leagues, Filter Generator right after the PoE1/PoE2 buttons): name, version, the history of every release from
  the program's own `CHANGELOG.md` (built in, no network), the newer version's release text when the updater knows it, the GitHub link. Details and About close with
  the cross, Esc, or a click anywhere outside the program window (window blur). `apps/<app>/CHANGELOG.md` is the single source: `tools/release-notes.mjs` cuts the
  section of the tag for the GitHub release page (a tag without a section stops the release).
- **Filter Generator tray**: X goes to the tray (menu: open the window / quit), "still running in the tray" balloon ONCE (`tray-hint-shown.txt`), a second start brings the
  window back, X-action option in About (default tray; saved in `close_action`), no tray icon = X closes the program. `TrayIcon` moved to `@poe/desktop/tray`.
- Drafts for part B updated: release.yml (Checker -> Releases of this repo, notes from the CHANGELOGs), README draft without the Checker (not linked).
- Files: `packages/desktop/src/{managed_updater,update_api,update_view,update_ui,changelog,modal,about,about_api,tray}.ts`, `apps/checker/*` (main, preload, renderer, settings),
  `apps/filtergen/*`, `tools/release-notes.mjs`, `apps/*/CHANGELOG.md`, tests `tests/checker/{update.e2e,changelog_view.test}.ts`, `tests/desktop/tray.e2e.ts`. Version 1.0.0-beta.15.

---

## 2026-10-18 (7) - beta.14: game buttons in the League row + PoE1 / PoE2 follows the game in front (committed, no tag, no release)

- Main window: `[PoE 1|PoE 2]  League: [dropdown]  [Refresh Leagues]` in one row (the toggle left the top right).
- New `auto_game` option (F8 > Game tab, default on). A 1 s poll of `GetForegroundWindow` (one cheap call; class / program path / title are read
  only when the window is a different one). **How the game is told**: the two games run from exes with the SAME names (checked on this machine:
  the Steam installs of both hold `PathOfExileSteam.exe` and `PathOfExile_x64Steam.exe`), so: a window is "a PoE client" when its class is
  `POEWindowClass` or its exe starts with `PathOfExile`; then the game = the install folder (`...\Path of Exile 2\` vs `...\Path of Exile\`:
  standalone, Steam, Epic that keeps GGG's folder name), and for a renamed folder the window title (`Path of Exile` / `Path of Exile 2`).
  Not seen on a live game here (none installed-and-running on this machine during the work): tested with stand-in windows in such folders.
- Rules: a game window comes to the front and is not the game that was in front before -> switch + new league list + a line in the Status
  and the log; a choice by hand stays until the OTHER game comes to the front; no game in front -> nothing changes; F4 / F5 use the game of
  the window they were pressed in (before anything else); the settings window does not switch the game back on Apply when the game moved while it was open.
- Files: `apps/checker/src/main/{game_detect.ts (new), native.ts (describeWindow), index.ts}`, `renderer/{main,settings}.ts`, `shared/api.ts`,
  `packages/node/src/config.ts`, `tests/checker/{game_detect.test.ts, phase6.e2e.ts, standin_game.{mjs,cs}}`.
- Tests: unit 14 (the game of a window, the rule), e2e 8 with stand-in game windows (layout, follow, both open, none, by hand, F5 key press before the poll,
  option off, title fallback, F8 option, F8 Apply). Version 1.0.0-beta.14.

---

## 2026-10-18 (6) - phase 5 part A: the Checker complete (committed, no tag, no release)

- `@poe/desktop` (new package): the filter page's main-process side, preload, renderer glue and the updater, shared by the Filter Generator and the Checker.
  Checker: filter page window, settings (F8) with hotkey rules, tray + close action (no tray = X closes), message over the game, NeverSink check
  (45 s, then 6 h) that regenerates through the filter page and tells in 3 places. mod-meta builder in TypeScript (byte-identical with the original's tool on both real
  datasets; 18 parity cases); shipped meta rebuilt with it. Self-update (electron-updater, banner, never closes the program by itself), Setup + zip for both programs,
  import report in the Checker's Status. Part B drafts in docs/release-draft/.
- Bugs found and fixed on the way: concurrent `AppConfig.save()`, F5 popup "Object has been destroyed", shared preload chunk. Details: docs/PHASE5.md.

## 2026-10-18 (5) - phase 4 bug fix: window flash on F5 / popup close, v1.0.0-beta.10 (committed, no tag, no release)

- Cause (docs/PHASE4.md): closing the popup (or the F4 window) while it held the focus made Windows give the focus to the Checker's main window, which jumped up over
  the game. Fix: remember the window in front at F5 / F4, give the focus back to it before closing. Also fixed: a picture on the clipboard made F5 fail.
- New in log.txt: the popup's life (shown at, hide / blur, who closed it, covered-by check at +150 / +600 / +1500 ms, raised again when covered).
- Tests: e2e 53 (new: M no window but the popup shows during F5, N focus back after Esc / Enter, O F4 window, picture on the clipboard). Dev tool: tests/checker/probe_windows.mjs.
- Not proven: why only PoE1 for Winai; the real game's focus rules.

## 2026-10-18 (4) - phase 4 round-fix: how F5 copies, v1.0.0-beta.9 (committed, no tag, no release)

- Ideas from EE2 (cca3066) and APT (3188208), **written from scratch - no code copied** (only the localized first lines of an item were
  cross-checked against EE2's table; those are game strings). PoE2 sends Ctrl + the game's "show advanced item descriptions" key + C
  (key read from `poe2_production_Config.ini`, read only; Alt + a log line when unreadable); PoE1 Ctrl+C with a log line on `{ Modifier }`
  headers; modifiers released ~10 ms after C; keys of the player's own hotkey handled (Ctrl+F5 / Shift+F5); the player's clipboard is
  restored (`f5_restore_clipboard`); non-English item text -> English-only message; the popup opens at the mouse position of the key press.
- New: `core/item_lang.ts`, `checker/main/{game_keys,item_copy}.ts`; `native.ts` `sendCopyChord` replaces `sendCtrlC`.
- Tests: copy.test.ts (24), item_lang.test.ts (14), e2e 45 (23 new: real key sequences, stuck keys, clipboard, 10 languages, popup position).
  A leftover INSTALLED Checker (beta.8) held F5 and made nearly every e2e case fail until it was closed - close the running Checker before `test:checker`.
- PLAN.md P5: hotkey clash rules for the settings window, full Thai support is post-release work.

## 2026-10-18 (3) - phase 4: the Checker with F4 skill reference + F5 trade (`apps/checker`), v1.0.0-beta.8 (committed, no tag, no release)

- core (all converted with byte parity against the original, 4,108 new parity cases + converted unit tests): item_parser, models, profiles,
  base_db, mod_db, meta_db, mod_badge, trade_url, skill_ref, league routing, the F5 flow (`f5.ts`), and the Python behaviours they need
  (`pyextra`: round / %g / float() / quote / sum; `difflib`). Dead code left out: the price-mode models, `ModValue.stat_id / value_min / value_max`,
  `py.uniq`. `AppConfig` takes its defaults (the Checker's keep the original's keys except the price-mode ones) and saves atomically.
- `apps/checker`: Electron main (hotkeys by `globalShortcut` with a clear message when a key is taken, F5 driver: clipboard clear ->
  `SendInput` Ctrl+C via koffi -> poll -> parse -> popup / browser; admin hint from `SendInput`'s access-denied and the elevation of the window in front),
  three windows with three typed bridges (main, F5 popup, F4 skill reference), config in `PoePriceTradeTS` imported once from `PoePriceTrade`.
- Tests: Electron e2e 22 (real key presses with a text box in front, url equal to the original's python for the same item / ticks, F4, leagues,
  config import, hotkey conflict with the running original, security); live run against the real hub and GGG; installed-exe run.
- Measured (beta.8, installed): Setup 98.5 MB, 325 MB on disk, window in 0.7-0.9 s (original 2.6 s), 320 MB working set (original 90).
- Not tested here (list for Winai): administrator game, borderless / fullscreen focus, the popup taking the keyboard in the game.
- Open: the tier-ladder data (`mod_meta_*.json`) is shipped from the original's current files; converting `build_mod_meta.py` is left for phase 5.

---

## 2026-10-18 (2) - phase 3 continued: installer instead of portable, v1.0.0-beta.6 (committed, no tag, no release)

- Winai chose the installer because the portable exe opened in 9-10 s. electron-builder target nsis, `oneClick`, per user
  (`%LOCALAPPDATA%\Programs\PoE-Filter-Generator-TS`), Start menu + Desktop shortcut, uninstall keeps `PoeFilterGenTS` and the game folders.
  Portable target, its splash image and `PORTABLE_EXECUTABLE_FILE` removed. `swap-exe.ps1`: close old -> build -> silent install over -> start the
  installed program -> check the title bar and the path. The CFA message now names the installed exe's full path.
- Measured: Setup 98.1 MB, install 10-21 s, 322 MB on disk, **start 0.8 s** (portable 9.3-10.6 s, original 2.0 s), memory 358 / 223 MB (original 68 / 34).
- Tested: desktop e2e 39/39 against the installed exe; `tests/desktop/installer.mjs` 21/21 (install over a running older version, settings
  identical, uninstall leaves `PoeFilterGenTS`, `PoeFilterGen` and game folders, reinstall); npm test 1,936, parity:check ok, tsc strict, eslint,
  web ui.mjs 119 and e2e 39.
- Found on the way: the install folder was named `@poefiltergen` (from the scoped package name) -> the packer sets `extraMetadata.name`.
  A silent install does not relaunch the program (by design of NSIS); the tests/swap script start it.
- Deferred (PLAN.md): auto-update, no-install zip, README / release names.

---

## 2026-10-18 - phase 3: Filter Generator on Electron (`apps/filtergen`), v1.0.0-beta.3 (committed, no tag, no release)

- `packages/ui` got one seam (`platform.ts`: network, names, store backend, game folder, desktop-only rows); the web page is unchanged
  (ui.mjs 119/119, web e2e 39/39). `apps/filtergen`: main / preload / renderer, `packages/node/src/config.ts` (AppConfig + one-time import
  from `PoeFilterGen`, the original's files only read). Build: electron-vite + electron-builder portable `dist\PoE-Filter-Generator-TS.exe`;
  `tools/swap-exe.ps1`, `pack-filtergen.mjs`, `measure-exe.ps1`.
- Tested: desktop e2e 39 (Playwright `_electron`, fake internet through Chromium host rules; also on the packaged `win-unpacked` exe):
  golden bytes of the original for 2 games x 2 tabs, start-up/title/log files, config import (hash + mtime of the old files unchanged),
  5 old filters, sounds (copy, `#`/`;`, same content, name clash asks, the original's paths), Controlled Folder Access message (EPERM),
  folder override, update check, single instance, security (no node in the page, name/URL guards, CSP, navigation). `npm test` 1,936,
  parity:check ok, tsc strict, eslint clean.
- Measured: exe 88.2 MB (estimate 85-105); start 9.3-10.6 s (original 2 s) because the portable exe unpacks ~320 MB every start;
  382 MB working set / 225 MB private (original 68 / 34). Levers and the decision needed: `docs/PHASE3.md`.
- Also: web deploy workflows' verify step fixed (`curl | grep -q` under pipefail); PLAN.md phase 2 = done.
- Open: Winai's test of the exe in the game folders; decision on the start-time lever.

---

## 2026-10-17 (7) - original's deploy job patched; verify step waits for the Pages build

- Original repo (c.f. its history.md): `deploy-web.yml` now writes only `legacy/` (commit 26e29f6, no tag). A manual run
  (`tag=v0.13.5`) succeeded: "legacy/ already up to date", live `/legacy/` reports 0.13.5; gh-pages blob list before/after
  identical for root and legacy (31 files), so nothing outside `legacy/` can have changed.
- `deploy-web.yml` here: the verify step polls the Pages build status (`errored` stops at once) and then the served page, up
  to 25 minutes, instead of a fixed 5 minutes.
- Phase 3 not started: waiting for Winai's test of the live page.

---

## 2026-10-17 (6) - TS web page is live at the root; old page in /legacy/

- `RELEASE_TOKEN` fixed by Winai; `deploy-web.yml` pushed gh-pages (the workflow's own verify step timed out because Pages was
  still building; the page was live a few minutes later). gh-pages: 25 files before (old page at the root) -> 31 after
  (root: `.nojekyll`, `index.html`, `assets/` x2, `data/` x2; `legacy/`: the old 25 files).
- Checked on the real URLs with Playwright: new page shows `web-1.0.0-beta.1`, lists load, Generate works (both games, both
  tabs, no console / network errors, real hub + GitHub); `parity.e2e.ts` against the live URL (`WEB_URL=...`) 36/36 byte-equal
  to the goldens; `/legacy/` shows `web-0.13.5`, Pyodide loads and Generate works.
- Open: Winai's check in his own browser; the original repo's deploy job still force-pushes (patch in `docs/legacy-deploy.patch`,
  not applied; do not tag the original).

---

## 2026-10-17 (5) - deploy retried: still 403; patch for the original's deploy job written (not applied)

- Second deploy run (16:05 UTC, after `RELEASE_TOKEN` was updated at 16:05:22): same 403 on push; gh-pages unchanged (25 files).
- `docs/legacy-deploy.patch`: proposed change to the original's `deploy-web.yml` (write only `legacy/`, normal push, no force,
  verify against `/legacy/`). Not applied; the original repo is untouched and must not be tagged until it is applied.

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

## (9) Part B1 - release workflow tested with prereleases (2026-10-19)
- Added `.github/workflows/release.yml`, `tools/check-release.mjs`, `release/update_public_readme.sh`; `deploy-web.yml` can be called by the release.
- Test-only env variables now need `POE_CHECKER_TEST=1` too. Removed a local path from a bundled comment (+ test).
- Real GitHub test found that `autoUpdater.channel` hid pre-releases from installed betas; fixed in both updaters, Checker feed file renamed `latest.yml`.
- Test prereleases v1.0.0-rc.1 / rc.3 released and deleted in both repos; Latest (v0.13.5), README and web untouched. Installed rc.2 -> rc.3 updated itself from GitHub in both programs.
- No v1.0.0 tag. Waiting for Winai: README draft, old-repo diff, the order to release.
