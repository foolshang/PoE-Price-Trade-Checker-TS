# Phase 5 - the Checker complete + ready to replace the original

Status: **part A built and tested** (the Checker has the filter page, settings, tray, message over the game, NeverSink auto-regenerate;
the tier-ladder builder is TypeScript; both programs update themselves; both come as a Setup and a zip). Waiting for Winai's test in the game.
**Part B (the release) is NOT done and does not start until Winai orders it** - drafts are in `docs/release-draft/`. No tag, no release.

## What part A is, item by item

| | Done as |
|---|---|
| **A1 filter page in the Checker** | The page of `@poe/ui` (the same as the Filter Generator and the web) in a window of its own, opened by the main window's **Filter Generator** button (`filter.html`). The shared main-process side moved to a new package `@poe/desktop` (`host.ts`: config `filter_gen`, game folders, allowed network hosts, flush-before-close; `preload.ts`; `page.ts`; `guard.ts`) - **both apps use it** (the Filter Generator's 39 golden-byte tests pass unchanged). `filter_gen` lives in the Checker's `PoePriceTradeTS\config.json`, never in `PoeFilterGenTS`. The page's game IS the Checker's game (switch either, the other follows, like the original's window which was bound to the Checker's game). Generate = the same code as the Filter Generator: golden bytes (3 tier cases + 2 whitelist cases per game, compared with the original). |
| **A2 auto-regen + 3 notices** | `regen.ts`: 45 s after the start, then every 6 h, only when a tier filter was made for the game and a newer NeverSink release exists; with `auto_regen_neversink` ticked the tier filter is generated again (through the filter page, shown or not: a hidden copy of the page is made for the job and thrown away - the sounds live in the page's storage, so the page is the only place that can write the filter exactly as the button does). Notices: the Status of the main window, the tray (balloon + red dot on the icon until the window is shown), and the **message over the game** (`overlay.ts`: a transparent window, `focusable:false`, `setIgnoreMouseEvents`, `showInactive`, always on top at the "screen-saver" level, bottom right, 8 s, green when regenerated / yellow when only told). Shown only by this check, never by a Generate by hand. |
| **A3 tray + X** | `tray.ts` (Show / Generate Now / Settings / Quit, red-dot icon while a message waits). `close_action` minimize / exit like the original. **No tray icon => the window is never hidden** (X closes the program; minimize stays in the taskbar); the settings window says so. |
| **A4 settings (F8)** | Tabs Game / Hotkeys / Advanced as in the original; no price-mode keys (overlay opacity, price offset, match threshold are gone); new: `f5_restore_clipboard`. Hotkeys (`hotkeys.ts`): refused with the reason on the page - Ctrl+C / V / A / F, Ctrl+Enter, Home, Delete, Enter, the arrows, a bare letter / digit / Space / Tab (my addition: it would be taken from the game's skills and from typing), anything that is not a hotkey, and duplicates (any spelling). Applying registers the new keys **at once**; if the system refuses one (another program holds it) the old keys are put back and the page names the field. A hand-edited / imported config with a bad hotkey falls back to the default with a line in the Status. |
| **A5 mod-meta builder** | `packages/core/src/mod_meta_build.ts` + `tools/build-mod-meta-main.ts`; `npm run mod-meta:build` (both games from repoe-fork -> `apps/checker/resources/`; `--local DIR`, `--game`, `-o`). **Byte-identical with the original's `tools/build_mod_meta.py`** on the real datasets (poe1 771,088 bytes / poe2 966,440 bytes, only the `generated` stamp differs) and on 18 hand-made parity cases (first-match spawn weights, the domain allow-list per game, abyss / cluster not leaking, merged tag sets, number / markup normalisation, tier order, the sanity floor). Time: about 0.9 s per game in TypeScript. The shipped `mod_meta_*.json` and the parity fixtures were rebuilt from the current datamine with it (parity re-run: 5,586 cases still equal the original). A source with a whole number written as `1.0` stops the build (JavaScript could not write it as Python does). |
| **A6 self-update** | `@poe/desktop/updater` (electron-updater 6.8.10, GitHub Releases): first check 20 s after the start, then every 6 h; downloads in the background; **never closes the program by itself** - the banner says "มีรุ่นใหม่ vX ติดตั้งเมื่อปิดโปรแกรม" with a **รีสตาร์ทเพื่ออัปเดต** button, the update is installed when the program is closed. A pre-release (a "-" in the version) is skipped by stable copies; a beta copy follows the betas (this is how a beta can be tested; the brief said "always skip" - that would leave testers without updates, so it is "skip unless I am a beta myself"). The zip copy cannot update itself: it only says a newer release exists, with the link. The checksum of `latest.yml` / `checker.yml` is checked by electron-updater; a wrong checksum or a feed that is down is a line in the log and nothing else. |
| **A7 Setup + zip** | `npm run desktop:pack` / `checker:pack` build both, plus the feed file (`latest.yml` for the Filter Generator, `latest.yml` for the Checker too since rc.2: the Checker has its own repo). Names: `PoE-Filter-Generator-TS-Setup-<v>.exe`, `PoE-Filter-Generator-TS-Portable-<v>.zip`, `PoE-Price-Trade-Checker-TS-Setup-<v>.exe`, `PoE-Price-Trade-Checker-TS-Portable-<v>.zip`. |
| **A8 import** | `PoePriceTrade` -> `PoePriceTradeTS` once (incl. `filter_gen`, hotkeys, league, `close_action`, `auto_regen_neversink` ...); the Status lists the keys taken over and the keys left behind (price-mode / OCR keys named, unknown keys named); the original's files are never written. |

## Findings on the way (all fixed)

- `staleness_hours`, `regen_cooldown_min`, `auto_regen` of the original's `filter_gen` defaults are **dead keys** (the original's own test says "not touched, just unused"). The real behaviour is the 45 s + 6 h poll with `auto_regen_neversink`; that is what was ported. There is no cooldown in the original.
- `AppConfig.save()` could fail when two saves ran at once (one temp file name): saves are now queued. Caught by a flaky unit test after the main process started saving from several places.
- The F5 popup could throw "Object has been destroyed" when a second F5 replaced it before its page loaded (an Electron error dialog and a process that stays). Fixed; every e2e test now fails if `log.txt` has an uncaught error.
- Two preload files that share code are built with a shared chunk, which a sandboxed preload cannot load (the main window got no bridge): the main preload carries its own copy; a test checks every preload is one self-contained file.

## Layout

```
packages/desktop/      @poe/desktop: host.ts (main side of the filter page), preload.ts, page.ts, guard.ts, updater.ts (+ _logic, _api), banner.ts
apps/checker/src/main/ index.ts (+ hotkeys.ts, tray.ts, overlay.ts, regen.ts, game_keys.ts, item_copy.ts, native.ts)
apps/checker/src/renderer/  index (main), settings, overlay, filter, picker, skillref
tools/build-mod-meta-main.ts   packages/core/src/mod_meta_build.ts   tools/parity/mod_meta_cases.py
tests/checker/  checker.e2e.ts (phase 4 + copy round + window flash)  phase5.e2e.ts  update.e2e.ts  hotkeys.test.ts  updater_logic.test.ts  feed.mjs
docs/release-draft/    part B drafts (not active)
```

## Tests (all run on the INSTALLED v1.0.0-beta.13 of both programs, and the build output before)

| | |
|---|---|
| `npm test` | 6,208 pass (unit + 5,586 parity cases against the original, incl. 18 new for the mod-meta builder); `parity:check` ok; the original's repo `git status` clean before and after |
| tsc strict, eslint | clean |
| web | `test:ui` all ok, `test:e2e` 39 |
| Filter Generator (installed) | 40: the golden bytes (unchanged by moving its code into `@poe/desktop`), config import, old filters, sounds, CFA message, update banner |
| Checker (installed) | 96 in 3 files: phase 4 + copy round + window flash (53), phase 5 (A filter page golden bytes, B settings, C tray / X / Generate Now, D NeverSink check, E overlay Win32 styles), zip (unpack, run, nothing written next to it, says a newer release) |
| self-update (installed Checker, local feed = the real pack) | 6: **installed beta.12 -> feed beta.13**: downloads in the background, banner, installs on the click, every setting kept, beta.13 starts; a feed that is down; a feed whose checksum is wrong; banner states |
| `tests/checker/live.mjs` | against the real hub and GGG: ok |

Honest notes: the key-press tests need the keyboard focus and fail now and then in a full run on the installed program (a different test each
time, never when run again alone) - the e2e config retries a failed test once; they all pass. One real race came out of those runs (the
message over the game while the program closes) and is fixed in beta.13. Filter Generator's own self-update flow was not run end to end (it is
the same code as the Checker's; its banner and its feed lookup are covered), because that needs two consecutive packs of it.

Sizes: Setup Checker 103.6 MB, zip 142.3 MB; Filter Generator Setup 103.0 MB, zip 141.6 MB. Building the tier ladders: 0.9 s per game.

## Needs Winai (in the game)

Close the **original Checker** first (it holds F4 / F5).
1. **The message over the game** (A2): a NeverSink update notice (to force one: tick "regenerate automatically", generate a tier filter, edit
   `neversink_tag_<game>` in `%LOCALAPPDATA%\PoePriceTradeTS\config.json` to an older tag, restart - the check runs 45 s after the start): it must show over the game in
   **fullscreen and borderless**, must not take clicks or the keyboard, and **must not throw the game out of fullscreen**. If it does, say so: the fallback is a smaller window / the tray balloon only
   (not silent: the Status always has the line).
2. F8 settings: change a hotkey and use it at once; the refused keys; a key another program holds.
3. The tray: X hides, Show brings it back; with "exit" X closes.
4. The Filter Generator button: generate a filter, reload it in the game.
5. Self-update is only provable on a real release (part B): until then the check finds nothing on GitHub (no release has the files).

## Part B (waits for the order)

`docs/release-draft/`: `release.yml` (workflow), `README_public.draft.md`, `old-repo-release-guard.diff` (a change for the ORIGINAL repo's
release.yml so it cannot publish over "Latest"; **not applied**), `B0-where-does-the-checker-go.md` (the question for Winai).

## Addendum (beta.14): game buttons + follow the game in front

Asked by Winai after the beta.13 test: (1) the PoE 1 / PoE 2 buttons moved into the League row, in front of League; (2) the program switches
PoE 1 / PoE 2 by itself to the game that is in front (F8 > Game: "Switch PoE 1 / PoE 2 by itself ...", default on).

- **How the game is told apart**: PoE1 and PoE2 have the same exe names (Steam: `PathOfExileSteam.exe`, `PathOfExile_x64Steam.exe` in both; the standalone ones
  `PathOfExile.exe` / `PathOfExile_x64.exe` in both). The window is a PoE client when its class is `POEWindowClass` or its exe starts with `PathOfExile`;
  the game then comes from the install folder name (`Path of Exile 2` -> PoE 2, `Path of Exile` -> PoE 1), and when the folder says nothing from the window
  title (`Path of Exile 2` / `Path of Exile`). Covers standalone, Steam, Epic (when the folder keeps GGG's name). `game_detect.ts`, 14 unit tests.
- **When**: a poll once a second (`GetForegroundWindow`, nothing else while the window is the same), `game window in front: ...` lines in `log.txt` give the
  class / title / path that were read. A game coming to the front that is not the game that was in front before -> switch + league list + Status line.
  A switch by hand stays until the other game comes to the front. F4 / F5 read the front window at the key press itself. No focus is ever taken.
- Not proven here: a live game (the stand-in windows copy the folder names and the title of the real ones; the class `POEWindowClass` is not exercised).

## Addendum 2 (beta.15): updates the player chooses, red dot, About, Filter Generator tray

Brief of Winai after beta.13 (part A of that brief = the beta.14 addendum above, already done). Part B: Checker only; Filter Generator keeps its beta.13 update banner until Winai says otherwise.

| | Done as |
|---|---|
| **B1 source** | Releases of `foolshang/PoE-Price-Trade-Checker-TS` (public); `electron-builder.yml` publish, the program's feed and its About link; not linked from the Filter Generator's README (draft). |
| **B2 check** | 20 s after the start, then every 24 h, with or without automatic update. Net down / feed broken: log only (`updater: check failed ...`). Test: `POE_UPDATE_EVERY_MS` shortens the period. |
| **B3 option** | F8 > Game: "Automatic update" (`auto_update`, **default ON** - proposal: a ~100 MB download in the background is cheap, and nothing is ever installed without a choice). OFF: announced only, no byte downloaded (tested: the feed saw no .exe request). |
| **B4 button** | Strip at the top of the main window, only while there is something newer: **update now** / **update when the program is closed** (-> "จะอัปเดตตอนปิดโปรแกรม" + cancel; only the real exit installs, the X that goes to the tray does not) / progress / failure with reason + try again. "Check for updates" button only without automatic update. |
| **B5 red dot** | Taskbar overlay icon + tray dot, one flag for the update and the NeverSink notice; focus on the main window (tray, taskbar, Show) opens the details (version + release text + NeverSink text + the update buttons) and clears the dot; closes with the cross or a click outside the program. Not set while the window is in front. |
| **B6 zip** | The button is "อัปเดต (เปิดหน้าดาวน์โหลด)". |
| **C About** | Both programs, built-in `CHANGELOG.md` (Thai, one per app, also the text of the GitHub release page via `tools/release-notes.mjs`), newer version's release text from the updater, GitHub links (Checker: its repo; Filter Generator: PoE-Filter-Generator). |
| **D Filter Generator tray** | X -> tray (menu open / quit), one-time balloon, X-action in About (default tray), second start brings the window back, no tray icon = X closes. |

Notes: the release text of a NEW version comes from the GitHub release body through electron-updater (HTML -> text in `changelog.ts`); it is only provable on a real release (part B). A local feed carries no release text, so the tests inject it.

### Red-dot manual test helper

`node tools/redtest.mjs start|stop|status` (dev tool, not packaged): serves a fake newer version (the real installer, fake Thai release notes) on 127.0.0.1:47653, makes the NeverSink tags look old and `auto_regen_neversink` off in config.json, and starts the installed Checker with `POE_UPDATE_FEED` set for that one process. `stop` restores the three config values from `%TEMP%\poe-redtest-state.json`, removes the fake download and starts the Checker normally.

## Addendum 3 - part B1: the release workflow, tested with a prerelease (2026-10-19)

No v1.0.0 tag, no Latest change, no public README, no web deploy. Test releases `v1.0.0-rc.1` and `v1.0.0-rc.3` were made and **deleted again** (both repos, tags too).

- `.github/workflows/release.yml` (tag `v*`, or Run workflow with `dry_run` / `only`): job `build` (Windows: typecheck, lint, tests incl. parity, pack both apps, `tools/check-release.mjs`, release notes from the CHANGELOGs) -> job `web` (real release only, `deploy-web.yml` via workflow_call) -> job `publish`: Filter Generator release (RELEASE_TOKEN, repo PoE-Filter-Generator) -> public README (real release only) -> Checker release (GITHUB_TOKEN, this repo). A failed step stops the rest; nothing is deleted or released again by itself. A tag with "-" is a prerelease: not Latest, no README, no web. Both runs took about 35 minutes (the dry run too).
- `tools/check-release.mjs`: tag == root package.json, both CHANGELOG sections, files, sizes, yml version / sha512 / size against the real Setup; a real release also needs `release/README_public.md` (not created yet: the draft waits for Winai).
- **Bug found by the real GitHub test:** both updaters set `autoUpdater.channel`, which electron-updater also uses as the name of the pre-release line, so an installed beta never saw any pre-release ("No published versions on GitHub" in the log). Fixed (channel left unset); `tests/checker/updater_selection.test.ts` runs the real GitHubProvider. A pre-release tag asks for `<label>.yml` first and falls back to `latest.yml`, so the Checker's feed file is now `latest.yml` as well.
- **Test-only environment variables** (`POE_UPDATE_FEED`, `POE_UPDATE_FIRST_MS` / `EVERY_MS`, `POE_CHECKER_DOCUMENTS`, `POE_FILTERGEN_DOCUMENTS`, game-poll and regen timers) count only with `POE_CHECKER_TEST=1` as well (`packages/desktop/src/test_env.ts`; unit test + a zip e2e that starts the unpacked zip with a feed and no test flag: the feed gets no request). The code is shipped, the gate is the guarantee.
- No dev files in the shipped programs: the Checker asar holds only `out/` plus koffi; the Filter Generator asar only `out/`; the zip holds the Electron files, `resources/{app.asar, app.asar.unpacked (koffi), app-update.yml, icon.ico, meta, elevate.exe}`. A comment naming a local path was found in the bundle and removed; `tests/checker/no_local_paths.test.ts` guards sources.
- Real self-update from GitHub (`tests/release/real_update.mjs`, installed rc.2 -> rc.3): Checker saw it 20 s after the start, downloaded it, showed the real release text in About, "update now" installed it in the same folder; the Filter Generator did the same (banner "installed when the program is closed", About text, restart button).
- Drafts for Winai: `docs/release-draft/README_public.draft.md` (complete, not pushed), `docs/release-draft/old-repo-release-guard.diff` (a real diff, checked with `patch --dry-run`, NOT applied).
- Helper for the red-dot test: `tools/redtest.mjs` (see above).
