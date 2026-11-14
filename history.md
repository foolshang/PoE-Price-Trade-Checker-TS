# PoE Price & Trade Checker (TypeScript) - History

> Entry format: date - summary - files touched - status / open problems.
> Newest entry on top. Heading: `## YYYY-MM-DD (n) - title`, n = the order of the entry within its day (1 = the first).

---

## 2026-11-15 (2) - v1.0.1 (cont.): GGG item names removed again as a source of the Whitelist lists (committed, no push / tag / release)

- **Why:** Winai ticked the PoE1 Scarab category (league Covens, 3.30); the game refused the whole filter: `Line 194: ... No base types found matching "Curio of Absorption Primordial..."`. 3.30 took the Scarabs out of the game, GGG's trade data still lists them, and the 4th source wrote GGG-only names into `BaseType` lines.
- **Evidence (read only, the file Winai generated, `poe-checker-whitelist.filter`):** line 194 is the tier C line of the Scarab / Fragment / Divination Card / Delirium Orb / Artifact names, 288 names sorted alphabetically; 287 of them are in neither NeverSink 8.21.0a nor the live hub (193 Scarab, 26 Divination Cards, 37 Fragment-type, 16 Artifact, 9 Delirium Orb, 4 Resonator, 1 Essence, 1 other). The first name the game rejects is the 53rd (`Curio of Absorption Primordial Fragment`), so the 52 GGG-only names before it (Scarabs up to `Cartography Scarab of the Multitude`, `Chayula's Breachstone` ...) were accepted by the game: "GGG lists it" is not "the game has it", and it is not "the game lacks it" either. The 235 GGG-only names from the 53rd on are unchecked by the game's first error. The real-name check passed all of them because it is built from NeverSink's names, the GGG list and the lists, so every GGG name passes it.
- **1.0.0 is safe:** the same run of the 1.0.0 code (tag v1.0.0, separate worktree, removed afterwards) with live data, every category on B, writes 0 Scarab names and only names that are in NeverSink 8.21.0a or the live hub (PoE1: 7,512 BaseType names; the only two not in the hub's item names or NeverSink, `Imbued Wand` and `Vaal Aspect`, are in the hub as unique base types; PoE2 the same with 248 `Runeforged ...` / `Glass Shank` bases). The hub has no Scarab (count 0), so the 1.0.0 lists have none to write.
- **Removed:** `ggg_names.ts` (rules, `addedNames`, `nextAssigned`), `universe()` 4th source, `gggAdded` / `gggOnly` / `gggUnset`, the `added` plumbing in the ui, the GGG log line, their tests and e2e cases. `universe()` is again hub -> NeverSink tier -> NeverSink category blocks. Kept: the snapshot / cache reader and writer (format 2, old bare list still read) in `trade_snapshot.ts`; `names:refresh` writes format 2 with an empty `assigned`; the real-name check is unchanged.
- **Archived:** `docs/GGG_CATEGORY_MAP.md` and `docs/GGG_UNMATCHED_NAMES.md` -> `docs/archive/` with a note. CHANGELOG 1.0.1 (3 apps): the GGG line is out. PLAN: after the release, a Thread category (PoE1) and empty categories.
- **Empty Scarab category (live data, no GGG names):** the category button is still offered, 0 rows; with Scarab = A (also with Fragment and Divination Card = A) the filter has 0 `Scarab` and 0 empty `BaseType` lines. UI not changed.
- **New test:** `packages/core/test/no_ggg_names.test.ts`: every category on B, GGG-only names given as extra names -> none in the filter, and every `BaseType` name is of NeverSink or the hub (both games). Tests: 6,419 passed, parity 5,557, test:ui 145 checks, web e2e 39. Desktop / Checker exe e2e NOT run (waiting for Winai's order).

---

## 2026-11-15 (1) - v1.0.1 (cont.): why the universe shrank (data, not the parser), Hardcore lists = softcore lists, GGG cache checked on the installed app (committed, no push / tag / release)

- **Check of the shrink 1,246 -> 1,043 (PoE1), read only:** the parser reads every name the file has. Live NeverSink 8.21.0a has no Scarab name at all (0 `BaseType` names with "Scarab"; the "[3601] Scarabs" section is gone; the fixture 8.20.1d has 118), and the live hub's Covens file has `Scarab: count 0` from poe.ninja (the fixture hub had 115 Scarabs). Also gone from NeverSink: 9 Vials and 47 tattoo names (category "NeverSink" 100 -> 53), 13 Divination Cards of the tier ladder. PoE2: 2 lineage gems less in the hub only (692 -> 690). Cause = the source data; nothing changed in the code for it.
- **Hardcore reads the softcore file of the main league** (`LeagueOption.listPath`; spec 8.1c: the HC file is the main league's counterpart only, so the index says which league it pairs with). The dropdown still offers main / Hardcore / events; the hub cache is by path, so Hardcore and softcore share one entry (no second request, no request for the hardcore file). Generate logs `ℹ ลีกที่เลือก: <league> · แหล่งรายชื่อไอเท็ม: <file>`. Tests: `leagues.test.ts` (listPath, one request), `tests/web/ui.mjs` (no hardcore request, same list, missing hardcore file changes nothing; missing event file = no list), desktop K and Checker F cases and `app_path.ts` updated (those two e2e files NOT run: waiting for Winai's order).
- **GGG cache on the installed Filter Generator exe** (temp profile, live GGG): no cache -> `trade_items_poe1.json` written in format 2 (22 groups, 7,912 names), Scarab list 193 rows, `Royal Visage` listed; old-form cache (names only, 7,904) fresh -> used, no crash, list the same (193 / 1 / 10 rows), file untouched; old-form cache older than 7 days -> reloaded from GGG and rewritten in format 2.
- **Slow zip:** `compression: maximum` in both electron-builder files makes the zip step 7za `-mx=9 -mfb=258 -mpass=15` (about 12-13 minutes per app on this machine; the NSIS Setup takes about half a minute).
- Files: packages/ui/src/{leagues,app}.ts, packages/ui/test/leagues.test.ts, packages/core/test/{app_path.ts,output_service.test.ts}, tests/web/ui.mjs, tests/desktop/desktop.e2e.ts, tests/checker/phase5.e2e.ts, the three CHANGELOGs, docs/PLAN.md.

---

## 2026-11-14 (5) - v1.0.1: GGG item names as the 4th source of the Whitelist lists (committed, no push / tag / release)

- New `packages/core/src/ggg_names.ts`: GGG payload -> names per group (`groupsFromPayload`), snapshot format 2 (`{format, groups, assigned}`; the old bare list is still read: names for the check, nothing added), rules "GGG group + name -> category" (`categoryByRule`), new-name fallback to the group's main category (`fallbackCategory`, never maps / waystones / tablets / internal ids / `badName`), `addedNames`, `nextAssigned` (a new name keeps its category in later snapshots). Table, live gap numbers and design: `docs/GGG_CATEGORY_MAP.md`; names not added: `docs/GGG_UNMATCHED_NAMES.md`.
- `filterWhitelist.universeWithSources` / `universe(..., ggg)`: GGG last, only names the first three sources lack, GGG's string unchanged. `resolveTiers` / `gggUnset`: a GGG-only name has no start tier (D in the list) and is not written until the player gives an item or category tier. `buildWhitelistFilter(..., gggAdded)` returns `ggg: {added, unset, written}` only when GGG names were given; `buildFilterText` logs "ℹ ชื่อจาก GGG ที่เติมในรายการ ... เขียนลง filter ... (หมวด n)". Golden / parity runners pass nothing: output unchanged.
- `tradeNames.getItems` replaces `getNames` (desktop cache `trade_items_<game>.json` in format 2; an old-form cache still serves the check until due; never deleted when GGG is down). IPC `fg:names` now returns `{names, groups}`. `ui/data.ts getNames` returns `added` (shipped snapshot = baseline for "new"); `app.ts` passes it to `wlLoad` / `generate`. `WlModel.setData(..., gggAdded)`, `WlData[3]`.
- `npm run names:refresh` writes format 2 and prints the newly assigned names; the shipped snapshots were refreshed from live GGG (PoE1 7,908 names, 40 assigned; PoE2 4,364, 0 assigned).
- Tests: `packages/core/test/ggg_names.test.ts` (63), `tests/web/ui.mjs` GGG cases, `app_path.ts` takes `added`. Desktop / Checker e2e not run (waiting for Winai's order).
- Open: "Hardcore uses the softcore file of the same league" (item 0 of the task) is not in this session's records - not done, asked in the report.

---

## 2026-11-14 (4) - v1.0.1: league choice on the filter page; planFetch removed with its parity cases; tier "no base" message; version 1.0.1, CHANGELOGs, installers (committed, no push / tag / release)

- League dropdown on the Whitelist tab (`packages/ui`: `leagues.ts`, `data.ts` getLeagues / getHub by path, `app.ts` resolveLeague / pickLeague / relist, `tab_wl.ts`). Options = main / hardcore / events of the game from `{game}/prices/index.json` (schema 1); item lists and Generate use the file of the league picked; cache 5 min by path; index not readable or wrong schema -> main only (latest.json) + a Status line; a league file that cannot be loaded -> no hub list (never another league's); the prices schema guard covers every league file; Generate logs the league. Filter Generator / web keep the pick in the settings (`hub_league_<game>`); the Checker page follows the main window (`window.desktop.onLeague`, `InitData.league`) and saves nothing. A load asked for during a load now runs after it; Generate waits for a running load. Core: `leagueFilesFromIndex()` split out of `HubClient.getLeagueFiles`.
- Hub CORS checked live (read only): index, hardcore and event files carry `Access-Control-Allow-Origin: https://foolshang.github.io`; the `/__hub` proxy of `web:local` serves them (200, schema 1 / 2). `desktop/guard.ts` unchanged (paths are under the same bucket prefix); guard tests added.
- `filterCore.planFetch` removed (only tests and its own 10 parity cases `calls/534-543` used it): cases taken out of `tools/parity/cases.py`, `parity:regen`; the other 894 `calls` results are identical (compared by function + arguments), ids after 543 moved up by 10, no other group changed, MANIFEST now names the original at 8d14eeb. Parity cases 5,567 -> 5,557. `composeFilterBody` is NOT dead (`ui/api.ts` WebApi.generate builds the filter text with it): kept.
- Tier tab without a base filter: "✗ nothing to write - no NeverSink base filter available - ไฟล์เดิมไม่ถูกแตะ" after the warning, like the original.
- Tests: `npm test` 6,396 -> 6,413; test:ui 119 -> 144 checks; desktop / Checker e2e cases added, NOT run. `app_path.ts` follows `app.ts`.
- Version 1.0.1 (root package.json), CHANGELOG 1.0.1 of the Checker, the Filter Generator and the web page. Both installers built and installed over the old ones, title bars checked.
- Open: e2e of the exes (waiting for Winai), `buildWhitelist` legacy engine and `LeagueChoice.leaguePaths` are only reached by golden cases (not removed: would change goldens), update rehearsal 1.0.0 -> 1.0.1 (plan in the report).

## 2026-11-14 (3) - v1.0.1 preparation: more unused code removed (committed, no tag, no release)

- Removed (no caller in any program code, checked by grep): `filterOutput.writeFilter`, `filterOutput.copySounds`, `filterOutput.filterPath`, `neversinkSource.fetchBaseFilter` and its private helpers (download, cache, last-check), `NeverSinkEnv.fs/nowMs`. Kept: `filterOutput.gameFilterDir` (desktop host), `neversinkSource.getLatestTag` (Checker update check).
- NOT removed: `filterCore.planFetch` - it has golden cases (`tests/parity/golden/calls.json`, runner `filter_core.plan_fetch`); removing it would mean editing goldens. Waiting for Winai. `filterCore.composeFilterBody` is in the same state (parity runner uses it).
- Tests: 6,406 -> 6,396. Removed 19 (6 `write_filter`, 7 `copy_sounds`, 6 `fetchBaseFilter`); added 9: 7 in `packages/ui/test/neversink_fetch.test.ts` (the same 6 cases + tag parsing, on `ui/data.ts` `fetchBase`, the code the programs run) and 2 in `packages/ui/test/to_crlf.test.ts` (CR never doubled). The `copy_sounds` and `write_filter` cases have no one-to-one counterpart: the sound plan they exercised (`planSoundFiles` / `resolveSoundPlan`) is still tested through the page path (`app_path.ts`), the CRLF case by `toCrlf`.
- Files: `packages/core/src/filter_output.ts`, `neversink_source.ts`, tests in `packages/core/test` and `packages/ui/test`, `docs/PHASE1.md`, `docs/PLAN.md` (after-release item: Generate coordination out of the DOM).
- Found by `npm run test:ui`: the web test harness (`tests/web/harness.mjs`) and the desktop / Checker stubs (`tests/desktop/stubs.mjs`) served the hub fixture without `schema_version`, so since the schema guard (9cf395f) the page treated the hub as not loaded and "Unique list is big and renders" failed. The two test servers now add `schema_version: 2` to the served prices (the fixtures and goldens are not touched; the real hub file has it - checked live). Desktop / Checker e2e on the installed exes were NOT run after this change.
- Status: nothing pushed, version still 1.0.0.

## 2026-11-14 (2) - v1.0.1 preparation: the filter tests run through the path the programs use; the unused filter_service code is removed (committed, no tag, no release)

- Compared the two paths first (read only). The programs make a filter in the page (`packages/ui/src/app.ts` generate() -> `api.ts` `WebApi.generate` -> `filterCore.buildFilterText`; deliver() -> `files.ts` `writeToFolder`, CRLF once; the desktop host writes the bytes). `filterService.generateFilter` was a separate copy of that flow that nothing in the programs called; only tests did.
- New `packages/core/test/app_path.ts`: the page's Generate for tests (the few lines of app.ts orchestration, each marked with its line; every piece of logic it calls is the real function). The 24 scenarios of the original's `filter_service_golden.json`, the sound-slot end-to-end tests and every whitelist test that used `generate()` now run through it.
- Result against the golden: **every written filter file is byte-identical** (sha256 of all scenarios that write a file, the stored small files, the sound files in the folder, mode / count / tag / name). So v1.0.0 writes what the original wrote for these inputs. Not compared any more: the original's own log lines, events and spied I/O calls of its filter_service (the programs do not have that service).
- Removed from `filter_service.ts` (each checked: no caller in any program code): `generateFilter`, `filterNameFor`, `ServiceDeps`, `ServiceEnv`, `GenerateOptions`, `GenResult`, `rememberResult` (the page's `afterGenerate` does this), `loadWhitelistInputs`. Kept: `writeFailMsg` (desktop host), `checkNeversinkUpdate`, `neversinkUpdateMessage`.
- Tests: `npm test` 6,410 -> 6,406 (-4, all in tests of the removed code): `renaming leaves the old file alone and says so` and `remember_result` (features of the removed function only), `the default log is a no-op`, and two `blocked write logs a friendly message` tests of generateFilter replaced by one `a failed write hands nothing over` (the CFA text itself stays covered by the `writeFailMsg` unit tests and the desktop e2e).
- Now without a caller in program code, left in place (not asked): `filterCore.planFetch`, `filterOutput.writeFilter` / `copySounds`, `neversinkSource.fetchBaseFilter`; the legacy (non-v2) whitelist builder is reached only when a config has no `wl_v2` (the page always sets it).
- docs/PHASE2.md corrected (it said the desktop app called these functions). Filter Generator CHANGELOG beta.3 wording and the PLAN notes (post-release F4 league-age view; `f5_restore_clipboard` checkbox done) were committed before.

---

## 2026-11-14 (1) - v1.0.1 preparation: hub schema guards, one hub address, documents brought up to date (committed, no tag, no release, version not bumped yet)

- `parity:check` first: ok, 5,567 cases give the committed goldens (the original is at 8d14eeb = the release guard, goldens made at 26e29f6; the original's `git status` stayed clean).
- Hub files are read only with the schema_version this code knows: prices / events / hardcore 2 (`getPrices` throws like a hub failure), `prices/index.json` 1 (null -> the latest.json fallback), `meta/latest.json` 2 (null -> a valid disk cache -> else no badges; a disk cache with another or no schema is ignored and never overwritten by a bad download), `gems.json` 1 (empty gem list). The warning names the file, the expected and the found version (`missing` when absent). New `packages/core/src/hub_schema.ts`, `packages/core/test/hub_schema.test.ts` (right / wrong / absent for each file). The live hub was read once to check the versions: index.json is **1** (SPEC 8.1b), not 2.
- `HubClient.getGems` removed (no caller anywhere). `filterService.generateFilter` was NOT removed: no program code calls it, but ~20 tests and the shared `generate()` helper of six whitelist test files run through it (waiting for Winai's decision).
- The hub address is written once (`HUB_BASE_URL`, core); `ui/data.ts`, `desktop/guard.ts` (same host and prefix) and the vite `/__hub` proxy read it.
- Documents: history.md reordered (newest on top, `date (n)` headings, n counted per day); README.md; CLAUDE.md title bar; PHASE3/4/5 current-status lines; PLAN.md sections C/F marked decided; `docs/release-draft/` -> `docs/archive/release-draft/`; new `apps/web/CHANGELOG.md`.
- Files: packages/core/src/{hub_schema,hub_client,mod_badge,index}.ts, packages/{ui,desktop}/src/{data,guard}.ts, apps/web/vite.config.ts, tests (hub_schema, net_clients, parity item_runner stub gets schema_version 2), docs.
- Tests run: `npm test` all pass after the stub fix (6,410 incl. the new ones), typecheck and lint clean. Not run: e2e (installed exe), web ui tests.

---

## 2026-10-21 (2) - v1.0.0 released

- Tag v1.0.0, release run green (build, web, publish); both releases Latest, README updated, web-1.0.0 live; the real Setups installed on the test machine (titles v1.0.0, no duplicate shortcuts, settings kept). An rc build cannot update itself to the stable 1.0.0 (electron-updater channel rule); the test machine was moved by hand. docs/PHASE5.md Addendum 11, PLAN phase 5 = done.

---

## 2026-10-21 (1) - v1.0.0

- Last fix before the release: a held F5 ran twice on a real keyboard (rc.13 log: the second run 9 ms after the popup). `RepeatGuard` now frees a hotkey only when the key is seen up AND no press came for 0.7 s (every repeat renews the quiet time), logs every decision, and the mouse position is read first in the hotkey callback (the native calls are loaded at start). Checked by Winai on rc.15: held 8 times, one run each. e2e 129/129 + 44/44, live.mjs, npm test 6,390.
- Release: version 1.0.0, CHANGELOG 1.0.0 (Thai, what the player sees), release/README_public.md from the checked draft, tag v1.0.0. The old repo's release workflow was already stopped from publishing (its commit 8d14eeb).

---

## 2026-10-20 (1) - Before v1.0.0: held keys, game in front, no "(TypeScript)" (v1.0.0-rc.13)

- A held F5 / F4 runs once (`RepeatGuard`, watched only after the action: a timer made inside the hotkey callback took the keyboard focus away from the popup); F5 / F4 send no key unless a Path of Exile window (or our own) is in front; "(TypeScript)" removed from every visible name (internal names kept; rc.10 -> rc.11 install checked: same folders, no duplicate shortcuts, settings kept); popup / F4 window hand the focus back and wait for it before closing; README draft checked against the real UI; CHANGELOG 1.0.0 drafts; the old repo's release guard applied and pushed (its commit 8d14eeb, no tag). docs/PHASE5.md Addendum 10.

---

## 2026-10-19 (8) - The hub's public alias file (v1.0.0-rc.10)

- Aliases from `{game}/aliases/latest.json` (SPEC 8.12), `stat_aliases` + `stat_groups` from it (no more guessing in dictionary.json), the bundled snapshot is the real file, the hub's 49 contract cases pass, the meta check is in `meta_rows.test.ts`. docs/PHASE5.md Addendum 9.

---

## 2026-10-19 (7) - Real PoE2 item texts, no property rows (v1.0.0-rc.9)

- 27 PoE2 item texts from Exiled-Exchange-2 as fixtures (credit in the folder); the no-header fallback skips property lines and reads no mods from gems / currency; every other mod resolves or is a real gap shown as "?". docs/PHASE5.md Addendum 8.

---

## 2026-10-19 (6) - F8 refuses the program's own copy keys (v1.0.0-rc.8)

- Hotkeys that equal what F5 presses to make the game copy (PoE1 Ctrl+C; PoE2 Ctrl + the game's advanced-description key, read from the ini each time F8 opens, + C) are refused with the reason, and listed in the settings page. docs/PHASE5.md Addendum 7. Raw PoE2 texts (Sanctified, augment, Grants Skill, Note) are still wanted from the player for the "no gray non-mod row" test.

---

## 2026-10-19 (5) - Labels of the item (v1.0.0-rc.7)

- Sections are classified before they are read: label lines (Searing Exarch Item, Fractured Item, Mirrored ...) are never mods; influences kept in `ParsedItem.influences`; multi-line reminders skipped; the "mod without a stat id" log is for the final misses only. PoE1 sends the reminder lines with plain Ctrl+C itself (no Alt). Details: docs/PHASE5.md Addendum 6.

---

## 2026-10-19 (4) - First in-game F5 findings (v1.0.0-rc.6)

- Reminder lines are not mods; ` — Unscalable Value` is cut; multi-line mods are matched as a block first (hub order) and shown as one row; the popup's X is logged as the player's and gives the focus back; "No published versions" is one info line; every copy chord releases Shift/Alt first and each F5 logs modifiers before/after, the events sent and how the text begins. Details: docs/PHASE5.md Addendum 5. The cause of the Alt in PoE1 is not proven yet.

---

## 2026-10-19 (3) - e2e: no silent skips

- `tests/checker/installed.mjs`: the installed Checker is found at the normal per-user path when PFG_CHECKER_EXE is not set; a missing exe / feed / zip now FAILS the group with the reason. A skip only with E2E_ALLOW_SKIP=1.
- Applies to the only two `skipIf` groups: `update.e2e.ts` B) (9 tests, were skipped without PFG_CHECKER_EXE) and `zip.e2e.ts` (2 tests). The other e2e files run the build output when no exe is given - that is a mode, not a skip.

---

## 2026-10-19 (2) - Stat id without guessing (v1.0.0-rc.4)

- Removed the difflib guessing of `find_stat_id` and of the badge dictionary fallback (the hub measured 92% of its guesses wrong). New `stat_match.ts` / `rendering_aliases.ts` (ports of the rules of the hub ModNormalizer and of its AliasIndex), `ModDatabase.lookup/findStatId`, `ModBadgeDB.badgeState`, a no-data marker in the F5 popup, a bundled alias snapshot, once-only log lines.
- Measured: 0 differences from the real normalizer of the hub on 120,000 texts (hub rules only); 0 wrong against RePoE (PoE1 16,173 wordings, PoE2 686) with the one addition described in docs/PHASE5.md Addendum 4 (the hub rules alone: 3 wrong).
- 434 of 5,586 parity cases changed on purpose and are listed and explained; the F5 end-to-end oracle answers stat ids from a table.
- Not done / waiting: the alias file and `stat_aliases` are not published by the hub yet; no tag v1.0.0.

---

## 2026-10-19 (1) - Part B1 - release workflow tested with prereleases

- Added `.github/workflows/release.yml`, `tools/check-release.mjs`, `release/update_public_readme.sh`; `deploy-web.yml` can be called by the release.
- Test-only env variables now need `POE_CHECKER_TEST=1` too. Removed a local path from a bundled comment (+ test).
- Real GitHub test found that `autoUpdater.channel` hid pre-releases from installed betas; fixed in both updaters, Checker feed file renamed `latest.yml`.
- Test prereleases v1.0.0-rc.1 / rc.3 released and deleted in both repos; Latest (v0.13.5), README and web untouched. Installed rc.2 -> rc.3 updated itself from GitHub in both programs.
- No v1.0.0 tag. Waiting for Winai: README draft, old-repo diff, the order to release.

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

---

## 2026-10-18 (5) - phase 4 bug fix: window flash on F5 / popup close, v1.0.0-beta.10 (committed, no tag, no release)

- Cause (docs/PHASE4.md): closing the popup (or the F4 window) while it held the focus made Windows give the focus to the Checker's main window, which jumped up over
  the game. Fix: remember the window in front at F5 / F4, give the focus back to it before closing. Also fixed: a picture on the clipboard made F5 fail.
- New in log.txt: the popup's life (shown at, hide / blur, who closed it, covered-by check at +150 / +600 / +1500 ms, raised again when covered).
- Tests: e2e 53 (new: M no window but the popup shows during F5, N focus back after Esc / Enter, O F4 window, picture on the clipboard). Dev tool: tests/checker/probe_windows.mjs.
- Not proven: why only PoE1 for Winai; the real game's focus rules.

---

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

---

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

## 2026-10-18 (1) - phase 3: Filter Generator on Electron (`apps/filtergen`), v1.0.0-beta.3 (committed, no tag, no release)

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

## 2026-10-17 (8) - original's deploy job patched; verify step waits for the Pages build

- Original repo (c.f. its history.md): `deploy-web.yml` now writes only `legacy/` (commit 26e29f6, no tag). A manual run
  (`tag=v0.13.5`) succeeded: "legacy/ already up to date", live `/legacy/` reports 0.13.5; gh-pages blob list before/after
  identical for root and legacy (31 files), so nothing outside `legacy/` can have changed.
- `deploy-web.yml` here: the verify step polls the Pages build status (`errored` stops at once) and then the served page, up
  to 25 minutes, instead of a fixed 5 minutes.
- Phase 3 not started: waiting for Winai's test of the live page.

---

## 2026-10-17 (7) - TS web page is live at the root; old page in /legacy/

- `RELEASE_TOKEN` fixed by Winai; `deploy-web.yml` pushed gh-pages (the workflow's own verify step timed out because Pages was
  still building; the page was live a few minutes later). gh-pages: 25 files before (old page at the root) -> 31 after
  (root: `.nojekyll`, `index.html`, `assets/` x2, `data/` x2; `legacy/`: the old 25 files).
- Checked on the real URLs with Playwright: new page shows `web-1.0.0-beta.1`, lists load, Generate works (both games, both
  tabs, no console / network errors, real hub + GitHub); `parity.e2e.ts` against the live URL (`WEB_URL=...`) 36/36 byte-equal
  to the goldens; `/legacy/` shows `web-0.13.5`, Pyodide loads and Generate works.
- Open: Winai's check in his own browser; the original repo's deploy job still force-pushes (patch in `docs/legacy-deploy.patch`,
  not applied; do not tag the original).

---

## 2026-10-17 (6) - deploy retried: still 403; patch for the original's deploy job written (not applied)

- Second deploy run (16:05 UTC, after `RELEASE_TOKEN` was updated at 16:05:22): same 403 on push; gh-pages unchanged (25 files).
- `docs/legacy-deploy.patch`: proposed change to the original's `deploy-web.yml` (write only `legacy/`, normal push, no force,
  verify against `/legacy/`). Not applied; the original repo is untouched and must not be tagged until it is applied.

---

## 2026-10-17 (5) - web deploy workflows; first real deploy stopped (403 on push)

- Added `.github/workflows/deploy-web.yml` (manual; first run moves the old page to `/legacy/`, then replaces the root web
  files, nothing else), `rollback-web.yml` (manual, `confirm=ROLLBACK`), `docs/DEPLOY.md`.
- Dry run on Actions: passed (names refreshed 7,685 / 4,363, version check ok, legacy move and file lists as planned).
- Real run: build ok, clone ok, **push to `foolshang/PoE-Filter-Generator` gh-pages refused: 403 "Permission ... denied to
  foolshang"** - `RELEASE_TOKEN` of this repo cannot write there (scope / repo access / expiry; the value was never read).
  gh-pages is unchanged (25 files, identical list before and after). Waiting for Winai to fix the token.
- Clash found: the original's `deploy-web.yml` force-pushes a single commit to gh-pages on every `v*` tag (see docs/DEPLOY.md).

---

## 2026-10-17 (4) - phase 2: web page on the TS core, no Pyodide (committed, no tag, not deployed)

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

## 2026-10-17 (3) - phase 1 done: filter core in TypeScript, byte parity with the original (not committed to a release, no tag)

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

---

## 2026-10-17 (2) - phase 1 started; decisions of Winai on the phase 0 questions

- Decisions: (1) npm workspaces; (2) `packages/ui` and `packages/node` accepted; (3) two exes; (4) `v1.0.0-beta.N` -> `v1.0.0`;
  (5) web staged at `/ts/`, Winai adds `RELEASE_TOKEN` to this repo himself when the release phase comes; (6) config in
  `%LOCALAPPDATA%\PoePriceTradeTS`, imported once from the original, the original's files are never written; (7) MIT licence
  (`LICENSE`); (8) **the EE2 / APT fork plan is cancelled** - F5 of the new program is our own (the original's history is not
  edited); (9) branch `master`; (10) Winai tells me when the original gets a bug fix so the goldens are refreshed.
- Tooling: TypeScript **6.0.3**, not 7.0.2: `typescript-eslint` 8.71.2 declares peer `typescript >=4.8.4 <6.1.0` (npm ERESOLVE
  with 7.x); vitest 5.0.5 runs with 7.x but lint is wanted, so the whole repo is on 6.0.3 until typescript-eslint supports 7.

---

## 2026-10-17 (1) - phase 0: skeleton, survey of the Python original, plan (nothing converted)

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
