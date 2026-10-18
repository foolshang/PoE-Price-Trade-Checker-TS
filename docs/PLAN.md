# Plan — PoE Price & Trade Checker (TypeScript)

Status table first (update it when a phase moves). Facts below were checked on 2026-10-17 (npm registry, the original
repo at v0.13.5, local experiments); estimates are marked as estimates.

| Phase | What | Status |
|---|---|---|
| 0 | Skeleton repo, survey of the original, this plan | done 2026-10-17 (waiting for Winai's decisions, section F) |
| 1 | `packages/core`: filter logic converted + byte parity against Python | done 2026-10-17, not committed as a release (see docs/PHASE1.md) |
| 2 | Web page on core TS (no Pyodide), live at the site root (old page in `/legacy/`) | done 2026-10-17 (docs/PHASE2.md, docs/DEPLOY.md); Winai tested the live page |
| 3 | Filter Generator on Electron | built as a one-click installer and tested 2026-10-18 (v1.0.0-beta.6), waiting for Winai's test; auto-update (electron-updater), a no-install zip and README / release asset names are decided when the release is prepared (docs/PHASE3.md) |
| 4 | F4 skill reference + F5 trade (hotkeys, Ctrl+C, clipboard) | built and tested 2026-10-18; copy round-fix 2026-10-18 (v1.0.0-beta.10), waiting for Winai in the game (docs/PHASE4.md) |
| 5 | Checker complete, replaces the original | part A built and tested 2026-10-18 (docs/PHASE5.md); part B1 (release workflow + prerelease test) done 2026-10-19; stat id matching fixed without guessing 2026-10-19 (Addendum 4, v1.0.0-rc.4); the real release (tag v1.0.0) waits for Winai and for the hub deploy check |

## C. Project structure (proposal)

```
packages/core     pure TypeScript: filter_core/gen/style/whitelist, wl_*, item_parser, trade_url, mod_db/badge,
                  meta_db, skill_ref, hub/neversink clients (take a `fetch` + a storage port). No DOM, no node:* imports,
                  so the same code runs in the browser, Node and Electron.
packages/ui       the Filter Generator renderer (tabs, style dialog, status log) = today's web/ JS, in TS. Used by
                  apps/web, apps/filtergen and the filter page of apps/checker.
packages/node     Node-only adapters used by both Electron mains: config.json (old format), disk cache, game folder
                  write, sound copy, logger with version marker.
apps/web          vite site; browser adapters (localStorage, IndexedDB, File System Access).
apps/filtergen    Electron app (main + preload + the ui renderer).
apps/checker      Electron app (main, hotkeys, F5 popup, F4 skill-ref window, tray, settings, filter page).
tests/parity      cases + golden files from the original + harness (section C4).
tools/            dev scripts (refresh names snapshot, copy data files, golden regeneration).
docs/             CONVERSION.md, PLAN.md.
```
Difference from the first idea (`core / checker / filtergen / web`): `packages/ui` and `packages/node` are added because
three apps share the same renderer and two share the same Node code; without them the code would be copied.

### C1. Tools (versions from `npm view`, 2026-10-17; exact pins at scaffold time)

| Need | Choice | Why / check |
|---|---|---|
| Package manager | **npm workspaces** (npm 11 is installed; pnpm is not) | electron-builder + pnpm needs hoisting workarounds; the two upstream overlays (EE2, APT) build with npm. Switch later is cheap. |
| Language | TypeScript (registry latest is 7.0.2) | check vite / vitest / electron-vite accept 7 at scaffold; if not, pin the newest 6.x. |
| Build | **vite 8.3** (web) + **electron-vite 6.0** (MIT, updated 2026-10-14) for the Electron apps | one config style for main / preload / renderer. |
| Unit tests | **vitest 5.0** (MIT) | pytest-like; same fixtures / golden files as the original. |
| UI / E2E tests | **Playwright 1.64** (Apache-2.0), including `_electron` for the exe | the 133 checks of `tests/web_ui/ui.mjs` already use Playwright. |
| Packaging | **electron-builder 26.15** (MIT), target `portable` (one exe) | like PyInstaller onefile. Unsigned (as today), so SmartScreen warns as it does now. |
| Electron | **44.8** (MIT, updated 2026-10-16) | built in: `globalShortcut`, `clipboard`, `Tray`, `Notification`, `shell.openExternal`, `dialog`, `app.requestSingleInstanceLock`, `app.getPath("documents")`. |
| zlib for the embedded settings | **pako 2.1.0** | measured: byte-identical to Python `zlib.compress(level 9)`; `node:zlib` and fflate are NOT (see R1). |

Libraries replacing Windows / Tk parts (maintenance and licence checked):

| Original | Replacement | Status |
|---|---|---|
| `hotkeys.py` (RegisterHotKey) | Electron `globalShortcut` | part of Electron, MIT |
| simulate Ctrl+C (`keybd_event`) | **koffi 3.3** -> `user32!SendInput` | MIT, updated 2026-10-10, prebuilt binaries, no node-gyp |
| (alternatives rejected) | `@nut-tree-fork/nut-js` 4.2.6 (Apache-2.0, last release 2025-03, heavy); `robotjs` 0.9.1 (MIT, needs a rebuild for every Electron ABI); `uiohook-napi` 1.5.5 (MIT, 2026-03, only needed if we must see key-up / not swallow keys) | |
| clipboard, tray, notification, browser open, folder pick | Electron built-ins | MIT |
| `config.json` read / write | own ~60 lines (exact old merge rules) | no library: `electron-store` would add its own file layout |
| DPAPI session id | none (unused) | |
| pystray / Pillow / winrt / PyInstaller | not needed | |

### C2. Executables

Estimate (not measured): each Electron portable exe is 85-105 MB (the two upstream overlays are ~100 MB; our originals are
12 MB and 29 MB). Levers: `compression: maximum`, `electronLanguages: ["en-US"]`, no `asar` bloat. Portable exe unpacks
to a temp folder on every start (a few seconds). Measure in phase 3 and report before phase 4.

### C3. Dev loop and exe rules

`npm run dev:<app>` for development; `npm run build:<app>` makes `dist/<name>.exe`; the post-build routine in CLAUDE.md
(close old exe, replace, start, check title bar) is a script (`tools/swap-exe.ps1`, written in phase 3). Every process
logs `version + build timestamp` first (CLAUDE.md rule 5).

### C4. Parity with the original (byte for byte)

1. `tests/parity/cases/*.json`: inputs (config, hub payload, NeverSink base, names, edit sequences). Seeded from
   `tests/test_web_parity.py` programs and the fixtures of the original tests, plus ~200 seeded random whitelist
   configs per game.
2. `tools/parity/gen_golden.py`: runs the ORIGINAL Python (`PYTHONPATH=$OLD_REPO`, read only) on every case and writes
   `tests/parity/golden/*.{filter,json}` + `manifest.json` (sha256 per file, original commit hash). Goldens are
   committed, so `npm test` needs neither Python nor the old repo.
3. `tests/parity/parity.test.ts` (vitest): runs core TS on the same inputs and compares bytes (on a difference it
   prints the first differing line); also compares the Status messages and settings after edits.
4. `npm run parity:regen` (needs Python + `OLD_REPO`) rewrites the goldens; `npm run parity:check` regenerates into a temp
   folder and fails if the original's behaviour has drifted from the committed goldens (the original still gets bug
   fixes: each fix must be ported, and this command is how we notice). Run it at the start of every phase and before
   each tag.
5. Special cases handled on purpose: the embedded config block (pako, plus a decode-and-compare check), and the traps in
   section R4.

### C5. Compatibility with the original

| Thing | Rule |
|---|---|
| `%LOCALAPPDATA%\PoePriceTrade\config.json` | read with the same merge rules (known keys only, `utf-8-sig`, dict defaults merged per key, F9 -> F4 migration). Decision F6: share the folder or import once into `PoePriceTradeTS`. |
| `.filter` files with `# poe-checker-config:` | open and edit again; v1 / v2 old whitelist files via the `wl_import` port; classification (`ok` / `no_config` / `tier` / `foreign`) identical. |
| Sound files | same copy rules (original name, `#`/`;` -> `_`, never overwrite silently, hash compare). |
| Web origin data | the TS page is served from the same origin as today, so it must keep `localStorage["poeFilterGen.cfg"]`, `["poeFilterGen.game"]` and IndexedDB `poe-filter-gen` v2 (sound files, per-game folder handles) readable and unchanged in shape. |
| Data files | `mod_meta.json`, `trade_names_*.json` copied as is. |

### C6. Release and cut-over (users must not stumble)

1. Releases keep going through `foolshang/PoE-Filter-Generator` (public repo, GitHub Pages, `RELEASE_TOKEN`). The TS
   repo's workflow publishes there, like the original's `release.yml` (tag must match the version in `package.json`;
   a tag with `-` is a prerelease and never "Latest").
2. **Web (decided by Winai, the `/ts/` step was skipped):** the TypeScript page is at the site root of
   `foolshang.github.io/PoE-Filter-Generator/` and the old Pyodide page lives in `/legacy/` (same origin, so settings and
   folder handles are shared). Deploy / rollback: `docs/DEPLOY.md`. The original repo's deploy job writes `/legacy/` only.
3. **Exe (decided by Winai after phase 3):** no release of any kind - no beta for the public - until every phase is done; then ONE release
   replaces the original (Filter Generator + Checker together; `v1.0.0`, asset names and README then). Until then the builds are only for
   Winai's own tests (installers `PoE-Filter-Generator-TS-Setup-<v>.exe` / `PoE-Price-Trade-Checker-TS-Setup-<v>.exe`, per user, no admin).
   Open for the release: auto-update (electron-updater), a no-install zip, README / release asset names.
4. The original repo is not touched except for bug fixes Winai asks for; at the very end Winai decides whether to archive it.

## D. Phases (order agreed with Winai; effort = estimated developer-days, rough)

| # | Scope | Effort | Risk | What Winai tests |
|---|---|---|---|---|
| 1 | Convert filter_core, filter_gen, filter_style, filter_whitelist, wl_embed / import / model / session, models, profiles, hub / NeverSink / names clients, filter_service, filter_output (pure parts); parity harness + CI; ~5,900 lines of logic + ~320 test functions | 10-14 | **High**: byte parity of 1,100 + 770 line engines; serialisation traps R4 | Almost nothing needs the game: parity is checked by hash. He may load 1-2 generated filters in game as a sanity check and read the parity report. |
| 2 | `packages/ui` (web JS -> TS), `apps/web`, Playwright suite, deploy of `/ts/`, drop Pyodide | 5-7 | Medium: UI regressions, IndexedDB / localStorage compatibility, File System Access flows | Chrome / Edge on his real data: open folder, open an old filter, Generate, sounds; Firefox download path; settings carried over from the old page. |
| 3 | `apps/filtergen`: Electron main / preload, `packages/node`, game-folder write, sound picker, single instance, portable build, size and start-time measurement, `swap-exe` script | 5-7 | Medium: exe size / start time, Controlled Folder Access when writing to Documents (the original README has a troubleshooting section for it), Defender on an unsigned Electron exe | Run the exe, write into the real `Documents\My Games`, open old filters, copy sounds, load the filter in game, config import from the old app. |
| 4 | F5 trade: hotkeys, SendInput Ctrl+C, clipboard, `item_parser`, `base_db`, `mod_db`, `meta_db`, `mod_badge`, `trade_url`, popup window; F4 skill reference: `skill_ref`, window | 12-16 | **High**: input and focus behaviour in the real game (borderless vs fullscreen, key swallowing, game started as admin blocks SendInput, popup must not steal focus) | All of it in game: F5 on PoE1 and PoE2 items (rare / magic / unique / unidentified / desecrated), popup, badge dots, URL opens the right search, F4 window, hotkey conflicts. |
| 5 | Checker complete: filter page inside the Checker, auto-regen + in-game notification, tray / close action, settings page, league dropdown, config migration, side-by-side checklist, cut-over steps | 5-8 | Medium | A normal week of use next to the original; auto-regen over a fullscreen game; tray behaviour; then the cut-over. |

Total about 37-52 developer-days. Phases 1-3 give a shippable Filter Generator and web page before the Checker work
starts (the Checker's filter page reuses phase 2-3 output).

**Phase 5 addendum (beta.14):** the game buttons sit in the League row; PoE 1 / PoE 2 follows the game window in front (`auto_game`, F8) - see docs/PHASE5.md.

**Phase 5 addendum 2 (beta.15):** Checker updates the player chooses (24 h check, automatic option, update now / on close), red dot + details window, About with a built-in changelog in both programs, Filter Generator tray - see docs/PHASE5.md.

## P5. Notes carried into phase 5 and after (from the phase-4 copy round-fix)

1. **Settings window (F8) - hotkey rules.** The hotkey fields refuse a key that clashes with the game or with editing keys, and refuse
   duplicates between the app's own hotkeys (F4 / F5 / F8 / quit). Forbidden: `Ctrl+C`, `Ctrl+V`, `Ctrl+A`, `Ctrl+F`, `Ctrl+Enter`,
   `Home`, `Delete`, `Enter`, the arrow keys (and `Ctrl+C`-style combos of any key the game's detailed copy uses: the chord F5 sends is
   Ctrl [+ the game's advanced-description key] + C). Show the reason next to the field, keep the old value.
2. **Item text in other game languages (post-release work).** F5 is English only: a copy whose first line is another language's
   "Item Class" / "Rarity" (Russian, French, German, Portuguese, Spanish, Thai, Korean, Chinese, Japanese) gets the message
   "F5 รองรับเกมภาษาอังกฤษเท่านั้น (ตั้งภาษาในเกมเป็น English)" and is not parsed. Full Thai (and other language) support needs the
   localized stat / base / item class tables and the trade site's language; it is **after the release**, not in phase 5. Known limit: an
   uncut gem in Thai / Simplified Chinese keeps the English word "Rarity:" on its first line, so it cannot be told from English there.
3. **Clipboard restore** (`f5_restore_clipboard`, default on) belongs in the settings window as a checkbox.

## R. Risks found while surveying (details for the phases)

- **R1 zlib bytes.** The embedded settings block is `base64(zlib.compress(json, 9))`. Measured here: `node:zlib`
  (zlib 1.3.1-e00f703, Chromium's fork) gives DIFFERENT bytes from Python for the same input (4 of 4 sizes); fflate also
  differs (3 of 4); **pako 2.1.0 is identical (4 of 4)**. Use pako in core.
- **R2 Object key order.** JS reorders integer-like keys (`"1".."6"` sound slots) in plain objects; use `Map` or an
  ordered array wherever Python iterates a dict.
- **R3 Input in game.** `globalShortcut` and `SendInput` are not the same code as `RegisterHotKey` + `keybd_event`; focus,
  repeat, held-key behaviour and admin-game blocking must be tested in the real game. Fallback: koffi
  `RegisterHotKey` thread if `globalShortcut` misbehaves.
- **R4 Serialisation / text traps** to pin with parity cases: `json.dumps` defaults (`ensure_ascii=True`, separators,
  `sort_keys`) vs `JSON.stringify`; `urllib.parse.quote` (safe `/`, escapes `!'()*`) vs `encodeURIComponent` in
  `trade_url`; sort by code point vs UTF-16; `round()` banker's rounding vs `Math.round`; `str(1.0)` -> "1.0"; `\w`,
  `$`, `re.IGNORECASE` differences (use the `u` flag and explicit classes); `str.title()`, `splitlines()` (splits on more
  characters than `\n`).
- **R5 Overlay over a fullscreen game.** The original proved a topmost click-through Tk window renders over the game; an
  Electron `BrowserWindow` (`alwaysOnTop("screen-saver")`, `setIgnoreMouseEvents(true)`, `showInactive`) must be proven
  the same way (phase 4/5).
- **R6 The original keeps changing.** Bug fixes there move the goldens; `parity:check` + `history.md` notes are the
  process.
- **R7 EE2 / APT fork plan.** `history.md` of the original (2026-10-13, entry 15) is waiting for decisions on replacing
  F5 with forks of Exiled Exchange 2 / Awakened PoE Trade. This TS plan keeps our own F5; the two plans overlap on F5
  and Winai should say which one wins before phase 4.

## F. Decisions needed from Winai

1. Package manager: npm workspaces (recommended) or pnpm.
2. Accept the added `packages/ui` and `packages/node` (recommended).
3. Exe size 85-105 MB each, two exes (recommended, like today) or one exe with a mode switch.
4. TS release line: `v1.0.0-beta.N` prereleases then `v1.0.0` (recommended) and the asset names in C6.
5. Staged web at `/ts/` of the same site (recommended) and copying `RELEASE_TOKEN` into the new repo's secrets (only
   Winai can add it).
6. Config handling: import once into `%LOCALAPPDATA%\PoePriceTradeTS` and never write the old file
   (recommended: the old app drops keys it does not know, so two writers on one file lose data) or share the old folder.
7. Licence of the new public repo (the original has none, so nobody may reuse the code today): none / MIT / other.
8. EE2 / APT fork plan vs our own F5 (R7).
9. Branch name: `master` (as the original, current) or `main`.
10. When the original gets a bug fix, tell me so I refresh the goldens (R6).
