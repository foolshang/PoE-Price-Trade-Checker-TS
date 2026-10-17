# Phase 1 - filter core in TypeScript, byte parity with the Python original

Original: `D:\Projects\PoE_Price-Trade_Checker` v0.13.5, commit c9c5752 (clean, never written to by this work).
Result on 2026-10-17: **1,916 tests pass** = 1,491 parity cases (+ 8 bookkeeping tests) + 417 converted unit tests;
`tsc` strict and `eslint` are clean; `npm run parity:check` (re-runs the original) reproduces the committed goldens.

## Commands

| Command | What it does |
|---|---|
| `npm test` | all vitest tests (about 2 minutes; no Python, no original repo needed) |
| `npm run typecheck` / `npm run lint` | `tsc` (TypeScript 6.0.3, strict) / eslint |
| `npm run parity:regen` | needs Python 3 + the original (`OLD_REPO`, default `D:/Projects/PoE_Price-Trade_Checker`): rewrites `tests/parity/cases` + `golden` (about 3 minutes) |
| `npm run parity:check` | re-runs the original and fails if it no longer gives the committed goldens (the original got a bug fix -> port it, then `parity:regen`). Prints a note when the original's commit differs from `golden/MANIFEST.json`. |

## How the parity test works

* `tools/parity/cases.py` writes `tests/parity/cases/*.json` (deterministic, seeded): tier-tab builds, legacy whitelist
  builds, hand-written whitelist-model scenarios (old configs, migrations, junk), 120 random whitelist scenarios = 264 cases (random
  edit sequences through the model API, then the whole generator with the resulting config, then re-opening the file),
  old v1/v2 filter files opened as both games, 60 damaged variants of them (blocks dropped / reordered / retiered / cut /
  CRLF), and 944 pure-function calls (styles, names, sound planning, embed, parsers ...).
* `tools/parity/oldlib.py` runs every case on the ORIGINAL Python (imported from `OLD_REPO`, bytecode off) and
  `gen_golden.py` stores the outputs in `tests/parity/golden/*.json`. Long texts are stored as `{sha256, length, lines}`;
  a few full texts are kept as `.txt.gz` (`golden/texts`) and all of them go to `.parity-cache/` (git-ignored) so a
  difference can be shown line by line.
* `tests/parity/runner.ts` runs the same cases on the TypeScript core; `parity.test.ts` compares. A text must have the
  same sha256 (every byte). A mismatch prints the first differing line. Checked: changing one character of the generated
  file fails the case and names the line.
* Inputs are the original's own test fixtures (`tests/parity/fixtures`: NeverSink s2 + base filters of both games, hub
  snapshots, GGG names snapshots, 5 old filter files) - no network.

## Conversion status

| Python module | TS module (`packages/core/src`) | Status | Parity |
|---|---|---|---|
| filter_style | filter_style.ts | done | 288 call cases |
| filter_gen | filter_gen.ts | done | 75 call cases + tier builds |
| filter_core | filter_core.ts | done (async `buildFilterText`, sound copy is a callback) | tier (84), legacy (28), 193 call cases |
| filter_whitelist | filter_whitelist.ts | done | model (52) + random (264) + 282 call cases |
| wl_model | wl_model.ts | done | same |
| wl_embed | wl_embed.ts (pako) | done | 70 embed/extract/classify call cases + every build |
| wl_import | wl_import.ts | done | open (59) + openmut (60) + 22 summary/version cases |
| wl_session | wl_session.ts | done | open cases + golden_open_messages (headless) |
| filter_service | filter_service.ts | done (ports: HTTP, file system, optional per-step `deps`) | golden of the original (24 scenarios) |
| filter_output | filter_output.ts | done (file system port) | unit tests, e2e sounds |
| hub_client | hub_client.ts | done (`HubClient`, HTTP port); price helpers for OCR dropped | unit tests |
| neversink_source | neversink_source.ts | done (HTTP + file system ports) | unit tests |
| trade_names | trade_names.ts | done | calls + service |
| (py helpers) | py.ts | new: Python semantics (truthiness, `int()`, `strip`, `split`, `sorted`, `json.dumps`, ...) | everywhere |
| (node adapters) | `packages/node/src/nodefs.ts` | new: `NodeFs`, `NodeHttp` | unit tests |

Not in phase 1 (by plan): `item_parser`, `mod_db`, `meta_db`, `mod_badge`, `trade_url`, `skill_ref` (phase 4), the Tk
screens (phase 2/3).

## Tests converted

| Python test file (functions) | Ported | TS file (cases) | Left out |
|---|---|---|---|
| test_bad_names (6) | 6 | core.test.ts | |
| test_filter_core (11) | 10 | core.test.ts | the "fresh interpreter with I/O modules blocked" test is replaced by an import-purity test |
| test_filter_vocabulary (3) | 3 | core.test.ts | |
| test_filter_gen (26) | 26 | filter_gen.test.ts (26) | |
| test_filter_whitelist (30) | 30 | filter_whitelist.test.ts (52) | |
| test_filter_output (14) | 14 | output_service.test.ts | |
| test_filter_service (11) | 11 | output_service.test.ts | |
| test_filter_service_golden (1) | 1 (24 scenarios) | service_golden.test.ts | |
| test_filter_sounds_e2e (3) | 3 | service_golden.test.ts | |
| test_sound_split (7) | 4 | output_service.test.ts | 2 Tk window tests (phase 3), 1 web glue test (phase 2) |
| test_filter_phase1 (20) | 14 | phase1.test.ts (39) | 6 Tk widget / window tests |
| test_hub_client (8) | 7 | net_clients.test.ts | 1 test of `PriceRepository` (price mode, dropped) |
| test_neversink_source (8) | 8 | net_clients.test.ts (9) | |
| test_wl_a3 (11) | 11 | wl_lists.test.ts | |
| test_wl_quest (5) | 5 | wl_lists.test.ts | |
| test_wl_neversink_blocks (8) | 8 | wl_lists.test.ts | |
| test_wl_tier_d (15) | 14 | wl_tiers.test.ts | 1 Tk panel test |
| test_wl_rarity (15) | 14 | wl_tiers.test.ts | 1 Tk panel test |
| test_wl_equip (17) | 16 | wl_equip.test.ts | 1 Tk panel test |
| test_wl_import (17) | 16 (3 window tests re-done headless) | wl_import.test.ts | 1 Tk-only duplicate |
| test_wl_session_golden (1) | 1 (headless twin of the window) | wl_import.test.ts | |
| test_wl_phase3b (25) | 12 + 4 model-level twins of Tk tests | wl_phase3b.test.ts | 9 Tk editor / window tests (opacity, editor round trips, open-filter dialogs, Q dialog) -> phase 2/3 UI tests |
| **Sum of the phase 1 scope** | **about 225 of 270 functions** | **417 cases** | the rest is Tk (replaced by Playwright in phases 2-3) or price mode |

Other files stay with their phases: item_parser (15), poe2_parser (9), poe2_magic (3), meta_db (16), mod_badge (44) -> phase 4;
web_glue (11), web_parity (6), web_ui (4) -> phase 2; wl_ui (18), thai_combobox (3), filter_gen_standalone (6) -> Tk, rewritten
in phase 2/3; matcher (7), normalizer (8), repository (16), build_web (4) -> dropped (price mode / Pyodide).

## Where Python and TypeScript differ by nature, and what makes the output equal

| Difference | Handling |
|---|---|
| `sorted()` on strings is by code point, JS by UTF-16 unit | `cmpStr` / `sortedStr` everywhere (astral characters sort like Python) |
| `str.strip()/split()/isspace()` and regex `\s` use Unicode white space (incl. `\x1c-\x1f`, `\x85`, `\xa0`; JS adds `\uFEFF`) | one white-space class `PY_S` and `pyStrip`, `splitWs`, `splitLines` in `py.ts` |
| regex `\d` / `\w` are Unicode in Python | `\p{Nd}` / `[\p{L}\p{N}_]` with the `u` flag; `$` also matches before a final newline in Python (`(?=\n?$)`); `.` is `[^\n]` |
| `int(x)` accepts strings with spaces/underscores, truncates floats, raises on `"5.5"`, `None`, lists | `pyInt` / `intOr` raise the same kinds of error (`PyError`) |
| truthiness of `0`, `""`, `[]`, `{}`, `None` | `truthy()` used wherever the Python wrote `if x` / `x or default` |
| `dict.get(k)` on a user-keyed dict ("constructor" is a method on a JS object) | `get`/`has` use own properties only |
| JS objects reorder integer-like keys | names/tiers are `Map`s inside the engine; plain objects only hold config |
| `json.dumps(ensure_ascii, sort_keys, separators)` | `py.dumps` (escapes everything outside 0x20-0x7e, sorted keys by code point, Python's float repr) |
| `zlib.compress(raw, 9)` bytes | **pako 2.1.0** gives identical bytes (measured; `node:zlib` and fflate do not) |
| negative list index (`LEVELS[-1]`) and `IndexError` | `pyIndex` |
| text files: Python text mode converts `\r\n`/`\r` to `\n` on read and `\n` to `\r\n` on Windows write | `NodeFs.readText` / `writeText` do the same, but normalise first so a file never gets `\r\r\n` (see finding F1) |
| JSON has no int/float distinction in JS | the engines never print a float; configs hold ints. A config value `3.0` is read as `3`. |
| `round()` is banker's rounding | not used by the filter code (only by trade/badge code of phase 4) |

## Findings in the original (not changed, for Winai)

* **F1 - CRLF.** NeverSink's PoE1 files (and the poe2 `base` fixture) have CRLF line ends. A text fetched fresh from GitHub
  keeps them; the original then writes it with `Path.write_text` in text mode, which on Windows turns `\r\n` into
  `\r\r\n` (the cached copy is read back with `\n` only, so only the first generate after a download is affected). Not
  verified in the game. The new `NodeFs` writes clean CRLF.
* **F2 - `wl_import.read`** picks the most common tier of a gear group with `max(set(...), key=count)`; ties depend on
  Python's string hash seed. Dead code today (no gear group is listed), the TS version takes the first one.
* **F3 - `neversink_filename(game, -1)`** works in Python by negative indexing (gives the "UBER-PLUS-STRICT" name); kept.

## Not done in phase 1

No UI, no Electron, no real network in tests (stub HTTP), `NodeHttp` is not exercised against the live servers.
