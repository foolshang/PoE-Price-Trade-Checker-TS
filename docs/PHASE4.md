# Phase 4 - the Checker: F4 skill reference + F5 trade (`apps/checker`)

Status: built as a one-click installer (`dist-checker\PoE-Price-Trade-Checker-TS-Setup-<version>.exe`, now v1.0.0-beta.9) and tested here; waiting for
Winai's test in the game. **No release, no tag** (decided by Winai: nothing is released until every phase is done; then one release replaces
the original - Filter Generator and Checker together). Title bar: `PoE Price & Trade Checker (TypeScript) v<version>`.

What is NOT in this phase (phase 5): the filter page inside the Checker, auto-regenerate + the in-game notification, the tray, the close
action, the settings window (F8), the league dropdown refinements. The main window only has what F4 / F5 need: the game, the league, the Status.

## What it does

| | |
|---|---|
| **F5** | presses the copy keys in the window in front (see the round-fix below; Win32 `SendInput` through koffi), waits up to 1.2 s for the item, parses it, fixes a magic item's base from the meta, infers prefix / suffix when the clipboard has no `{ Modifier }` headers, then either opens the trade page (unique / unidentified / `f5_mod_picker` off) or shows the **mod popup** (rare / magic): tick the mods, type min / max, Enter / Search -> the browser opens the search. The player's clipboard is put back (round-fix). |
| **F4** | the skill reference window (always; the original's price-scan mode is gone): type a skill, pick it, level bracket, mods per slot, passives. Data from the hub, loaded at every open, schema versions checked. |
| **Leagues** | the hub's `index.json` -> main / hardcore / events in the dropdown; auto-pick main (or hardcore when `prefer_hardcore`); the choice is saved. |
| **Hotkeys** | `F4`, `F5`, `Ctrl+Alt+Q` (from the config; the old `F9` becomes `F4`). A key another program holds is named in the Status and in `log.txt` with what to do (close the original Checker). F8 (settings) comes with the settings window. |
| **Config** | `%LOCALAPPDATA%\PoePriceTradeTS\config.json`, imported once from `PoePriceTrade` (known keys only; the price-mode keys - overlay, scan, currency unit, `f4_mode` ... - are read and dropped, no error); the original's files are never written. `mod_meta_{game}.json` (tier ladders) in that folder wins, else the one shipped with the program; `money_mods.json` / `mod_badge_rules.json` overrides are read from it as before. |
| **Other** | single instance, `log.txt` + `last_run.txt` + version first, `debug_logs\last_raw_item.txt` / `last_session.md` like the original. |

### Layout

```
packages/core/src/   item_parser, models, profiles, base_db, mod_db, meta_db, mod_badge, trade_url, skill_ref, league, f5 (+ difflib, pyextra)
apps/checker/src/main/index.ts       hotkeys, F5 driver, windows, hub / GGG, browser, config
apps/checker/src/main/native.ts      SendInput + "is the window in front elevated?" (koffi)
apps/checker/src/main/picker_data.ts what the popup shows;  shared/picker_text.ts = the row texts of the original's ModPickerWindow
apps/checker/src/preload/            three bridges: main.cjs, picker.cjs, skill.cjs (shared/api.ts is the typed list)
apps/checker/src/renderer/           index (main window), picker, skillref pages
tools/parity/item_calls.py, item_cases.py, f5_expect.py     the original side of the parity cases / the end-to-end expectations
tests/parity/item_runner.ts          the TypeScript side;  tests/checker/                  the Electron tests
```

## Round-fix (beta.9): how F5 copies

Ideas taken from Exiled-Exchange-2 (commit cca3066) and Awakened PoE Trade (commit 3188208); **all code is our own - nothing was
copied** (no function, no table, no native module). The only thing cross-checked against EE2 is the localized first line of an item
("Item Class" / "Rarity" in each game language), which is game data, not code; our table is in `packages/core/src/item_lang.ts`.

| | |
|---|---|
| **PoE2 keys** | Ctrl + the key of "show advanced item descriptions" + C. The key is read (read only, never written) from `<Documents>\My Games\Path of Exile 2\poe2_production_Config.ini`, `[ACTION_KEYS] show_advanced_item_descriptions=<virtual key> [1 Shift / 2 Ctrl / 3 Alt]` (`game_keys.ts`). Unreadable / unbound -> Alt, and `log.txt` + the Status say so. |
| **PoE1 keys** | Ctrl+C. The `{ Modifier }` header presence is logged on every F5 (Status + `debug`); without headers `infer_affixes` still runs. |
| **Release** | modifier down -> C down / up -> ~10 ms -> modifiers up in reverse (`native.ts sendCopyChord`). Keys of the player's own hotkey: a chord key already held is not pressed or released again (Ctrl+F5), another held modifier is released first (Shift+F5), so the game never sees Shift+Ctrl+C. |
| **Clipboard** | the player's text (or picture) is kept; cleared first only when it is an old item text (so the new one is recognised); put back when the item has arrived or after the 1.2 s wait (50 ms poll). Config `f5_restore_clipboard` (default true); false = emptied at the end like the original. |
| **Language** | first line of another game language -> "F5 รองรับเกมภาษาอังกฤษเท่านั้น (ตั้งภาษาในเกมเป็น English)", no parse, no trade, no popup. Full Thai = post-release (PLAN.md P5). |
| **Popup** | opens where the mouse was when the key was pressed, not where it is when the item has been read. |

Tests (round-fix): unit `tests/checker/copy.test.ts` (ini parsing, key chord, clipboard cases with a fake clipboard) and
`packages/core/test/item_lang.test.ts`; e2e I / J / K / L in `tests/checker/checker.e2e.ts`: the key events the box in front really saw
(PoE1, PoE2 with Alt / `82 2` / `17` in the ini and with no ini; Ctrl+F5 and Shift+F5 hotkeys; the C-up to modifier-up gap), no Ctrl / Alt / Shift
left down after F5 (`GetAsyncKeyState`), clipboard restored (success / time out / restore off), 10 languages -> the message with no trade page
or popup or error, the popup near the first mouse position, the ini byte-identical after F5. Known limit of the test: the box does not see the
player's own Ctrl-up, so for Ctrl+F5 the test checks only what the program does (one Ctrl-down, none of its own Ctrl-up).

## Bug fix (beta.10): "a Checker-looking window flashes on F5"

Report: PoE1, F5, a window like the Checker's shows for a moment and goes (not a console).

Evidence (nothing guessed; `tests/checker/probe_windows.mjs` logs every window event and samples the OS's own window list every 10 ms):
- F5 itself shows, focuses, restores or flashes **no** window of the program except the popup (OS list: only the main window and "เลือก mod";
  the main window gets no show / focus / restore event). Unique items (no popup) create no window. The popup is created hidden, sized and
  placed first, shown after its page has painted, and is never seen at any other place. The code path of PoE1 and PoE2 for windows is the same.
- **Closing the popup (Esc, Enter / search, the cancel button) gave the keyboard focus to the Checker's main window** (event `focus` on it,
  reproduced with a plain window standing in for the game; the new tests N failed before the fix). When the window that holds the focus is
  destroyed, Windows hands the focus to another window of the same program, not to the game: the main window jumps up over the game and
  disappears again when the browser / game takes the focus back. The F4 window did the same.
- Another real bug found on the way: when the clipboard held a **picture**, restoring it failed (`clipboard.write cannot accept a
  ClipboardItem returned from clipboard.read()`) and F5 ended with an error and no popup. Fixed (the picture is kept as bytes).

Fix: the window in front when F5 / F4 is pressed is remembered (`native.ts foregroundWindow`); before the popup / skill window is closed,
the focus is given back to it (`focusWindow`) when the popup still has the focus. `log.txt` now has the popup's life: shown at (bounds + mouse),
hide / blur / minimize, who closed it, renderer gone, and what Windows says 150 / 600 / 1500 ms after it is shown (visible, focus,
windows covering it; a covered popup is raised again).

Not proven here: why Winai saw it on PoE1 only (the code is the same for both games), and the behaviour of the real game (fullscreen / borderless
focus rules). Tests: M (no window except the popup during F5, 4 items, PoE1 and PoE2, popup/no popup), N (Esc / Enter give the focus back), O (F4 window),
picture on the clipboard.

## Parity with the original (byte for byte)

4,108 cases run on the original (Python, read only) and on the core: the parser (47 fixture clipboards x both games: rare / magic / unique /
normal / unidentified / desecrated / fractured / rune / enchant / corrupted / no-header / currency / gem / map / jewel / Thai / Arabic digits /
CRLF / garbage), the trade urls (incl. quoting and `40.0` floats), the whole F5 flow (rows, stat ids, tiers, money, summary, badge colours,
roll arrows for every archetype), the fuzzy `difflib` matching of mods and bases, the hub badge data, the skill reference (real hub data,
schema mismatch), league routing, and the Python behaviours the port imitates (`round`, `%g`, `float()`, `sum`, `quote`, `difflib`).
The original's unit tests of these modules are converted (`packages/core/test/item_pipeline.test.ts`, `pyextra.test.ts`).

Differences found and handled on the way (not copied bugs, not visible in output): `\d` of a Python `str` regex is any Unicode digit
(a regex template with `\.` lost its backslash once: the fuzzy cases caught it); `sum()` of floats is compensated since 3.12;
`round()` is exact; `ModValue.stat_id / value_min / value_max` are never set or read in the original -> not converted (the parity
adapter adds them back to compare whole records).

## Tested here

- `npm test` + `parity:check`, `tsc` strict, eslint, web (`ui.mjs`, e2e), filter generator (desktop e2e) - see the phase report.
- `tests/checker/checker.e2e.ts` (Playwright `_electron`, fake internet through Chromium host rules): **real key presses** - a text box
  holding the item is brought to the front, F5 is pressed, the program sends Ctrl+C to it, reads the clipboard, shows the popup; the url it
  opens equals the one the ORIGINAL (python) builds for the same item and ticks (`tools/parity/f5_expect.py`): rare, magic, PoE1 without
  headers, ring with desecrated / implicit, unique (no popup), cancel with Esc, not-an-item, nothing selected. F4: search, brackets, slot
  tabs, mods and passives from the hub fixture, no match, hub down. Leagues (main / hardcore / events, `prefer_hardcore`, game switch,
  refresh, no index). Config import (price keys dropped, old files byte-identical). **Hotkey conflict**: the original program running ->
  F4 / F5 named in the Status and `log.txt`. Security: each window has only its bridge, no node, strict CSP, safe web preferences. Single
  instance. `SendInput` itself on a plain window.
- `tests/checker/live.mjs`: against the REAL hub and GGG - leagues, skill data (63 mods / 18 passives for the first skill), F5 popup on
  a rare with real stat ids (9 of 9 rows searchable).
- Not testable here: the **administrator** warning (needs an elevated game window; the code reads `SendInput`'s access-denied and the
  elevation of the window in front), focus and borderless / fullscreen behaviour of the popups.

## Build

`npm run checker:build` · `checker:pack` (electron-builder nsis, one-click per user -> `dist-checker\`) · `checker:swap` (close old, pack,
silent install, start, check the title bar and the install path) · `test:checker`. koffi's prebuilt binary is fetched by
`npm run desktop:setup` (npm's script policy skips it). The installer unpacks `koffi` outside the asar; `mod_meta_{game}.json` (1.5 MB,
datamine tier ladders built by the original's `tools/build_mod_meta.py` from RePoE) ship in `resources\meta`.
Open: converting `build_mod_meta.py` (the data is refreshed by hand today, as in the original) - to decide with phase 5.

## Measured (installed, throw-away LOCALAPPDATA)

| | new Checker (beta.8, size unchanged in beta.9) | original Checker (Python exe) |
|---|---|---|
| file to hand out | Setup 98.5 MB (103,323,206 bytes) | exe 28.7 MB |
| on disk | 325 MB | 28.7 MB |
| start -> window | 0.7-0.9 s | 2.6 s |
| memory after 6 s | 320 MB working set / 186 MB private, 4 processes | 90 MB / 405 MB (commit), 2 processes |

## Needs Winai (in the game)

**Close the original Checker first** (it holds F4 / F5). F5 on PoE1 and PoE2 items of every kind (rare, magic, unique, unidentified,
desecrated, fractured) -> popup -> the trade page opens right, badges right; F4 window; borderless / fullscreen not thrown out by the
popups; keys not clashing; the league right (main / hardcore / event); the popup opens near the mouse and takes the keyboard (Enter / Esc);
a game started as Administrator gives the warning.

Round-fix list: the Status shows the key chord used (`F5 (Ctrl+Alt+C)`) and whether the item text had `{ Modifier }` headers (PoE1 and PoE2); the popup opens where the mouse was at the key press; no Ctrl / Alt stuck after F5 (also with Ctrl+F5 / Shift+F5 as the hotkey); the clipboard has your own text again after F5; an item copied from a non-English client gives the English-only message.
