# Conversion table — Python original -> TypeScript

Source: `D:\Projects\PoE_Price-Trade_Checker` (v0.13.5, master c9c5752), read only. Surveyed 2026-10-17.

Type: **[direct]** pure logic, convert 1:1 · **[rework]** tied to Windows / Tk, replaced by an Electron / Node
facility · **[web]** Tk screen that already has a web page (or is replaced by renderer HTML) · **[drop]** price (OCR)
mode or obsolete.
Size (developer-days, code + tests + parity): **S** <= 0.5 · **M** ~1 · **L** 2-3 · **XL** 4+.

Totals of `poe_price_trade/` (5,870 / 2,600 / 1,830 / 840 lines, about 11,140 in all): [direct] 22 files, [rework] 11,
[web] 5, [drop] 7 + `ocr/` (3 files).

## poe_price_trade/

| File | What it does | Lines | Type | Size / note |
|---|---|---:|---|---|
| `__init__.py` | `__version__ = "0.13.5"` | 1 | direct | S — root `package.json` version replaces it |
| `__main__.py` | entry point | 9 | drop | replaced by Electron `main` |
| `app.py` | Tk app: overlay, hotkeys, F4 scan+hover, F5 flow, tray, settings, auto-regen | 875 | rework | **XL** — keep F5 flow (Ctrl+C -> parse -> picker -> URL), F4 skill_ref launch, tray, auto-regen; drop scan/hover/OCR loop; rebuilt as Electron main process |
| `base_db.py` | resolve raw base / unique names to canonical trade names | 156 | direct | S |
| `capture.py` | GDI screen capture (OCR) | 150 | drop | price mode |
| `clipboard.py` | read / write Windows clipboard via ctypes | 80 | rework | S — Electron `clipboard` (built in) |
| `config.py` | `config.json` in `%LOCALAPPDATA%\PoePriceTrade` + DPAPI POESESSID | 182 | rework | S-M — JSON merge logic ported exactly; DPAPI part dropped (POESESSID unused since `trade_client.py` was removed) |
| `debug.py` | session logger (`log.txt` overwritten per start) | 77 | rework | S — own ~40-line logger, prints version + build timestamp unconditionally |
| `filter_core.py` | filter body composition, NeverSink URL, name validation, sound plans | 425 | direct | L — byte parity |
| `filter_gen.py` | tier / ladder sounds, rules, Pyodide-safe helpers | 360 | direct | L |
| `filter_gen_standalone.py` | Tk shell of the standalone Filter Generator | 198 | web | M — becomes `apps/filtergen` main + shared renderer |
| `filter_output.py` | Documents dir, write `.filter`, copy sounds, sha256 | 125 | rework | S-M — `app.getPath("documents")` (SHGetKnownFolderPath, OneDrive aware), `node:fs`, `node:crypto` |
| `filter_service.py` | config + game + league -> filter (checker independent) | 208 | direct | M — I/O injected as in the original |
| `filter_style.py` | style dict -> filter lines | 204 | direct | M |
| `filter_style_editor.py` | Tk style editor widget | 323 | web | S-M — `web/js/style_dialog.js` (146 lines) already exists |
| `filter_whitelist.py` | Whitelist engine (tiers, categories, blocks, text) | 1108 | direct | **XL** — biggest file, most of the byte-parity risk |
| `filter_window.py` | Tk window of the NeverSink tab + generate flow | 490 | web | M — `tab_ns.js` + `app.js` exist |
| `hotkeys.py` | `RegisterHotKey` thread + Tk dispatch | 124 | rework | S — Electron `globalShortcut` (built in); see PLAN risk R3 |
| `hub_client.py` | poe-data-hub fetch (prices, leagues, meta, passives) | 171 | direct | S-M — `fetch`, same URLs, same cache rules |
| `item_parser.py` | Ctrl+C item text -> `ParsedItem` (PoE1 + PoE2) | 253 | direct | M — regex heavy |
| `matcher.py` | fuzzy match OCR text against names | 56 | drop | price mode |
| `meta_db.py` | tier ladder + money-mod annotation (`mod_meta.json`) | 258 | direct | M |
| `mod_badge.py` | popup dot / arrow / P-S marker from hub meta | 407 | direct | L |
| `mod_db.py` | mod text -> GGG stat id (stats endpoint + disk cache) | 155 | direct | M |
| `mod_picker.py` | F5 popup: tick mods, min / max, open trade | 207 | rework | M-L — a small always-on-top `BrowserWindow` + HTML |
| `models.py` | `ParsedItem`, `ModValue`, `Rarity` ... | 125 | direct | S |
| `motion.py` | camera-motion detector (OCR hover) | 63 | drop | price mode |
| `neversink_source.py` | NeverSink GitHub fetch + cache | 156 | direct | S-M |
| `normalizer.py` | OCR name normalisation | 42 | drop | only used by `matcher` / `repository` |
| `ocr/__init__.py`, `base.py`, `windows_ocr.py` | WinRT OCR | 141 | drop | price mode; winrt not shipped |
| `overlay.py` | click-through topmost price overlay + `show_message` | 211 | rework | S-M — only the auto-regen message is kept: transparent `BrowserWindow`, `setIgnoreMouseEvents(true)`, `alwaysOnTop("screen-saver")` |
| `profiles.py` | per-game constants (endpoints, category map) | 90 | direct | S |
| `repository.py` | price cache + league list from hub index | 263 | drop | price lookup is OCR-only; the league-list part (index.json) moves into the `hub_client` port |
| `scan.py` | capture -> OCR -> match | 114 | drop | price mode |
| `settings.py` | Tk settings window (F8) | 209 | rework | M — new renderer page (no web page exists) |
| `skill_ref.py` | F4 skill-reference data layer (hub passives) | 247 | direct | M |
| `skill_ref_window.py` | F4 skill-reference Tk window | 380 | rework | **L** — HTML window |
| `trade_names.py` | real item names from GGG trade data (+ snapshot) | 57 | direct | S |
| `trade_url.py` | build trade URL + open browser | 95 | direct | S — `shell.openExternal`; **URL encoding parity** (R4) |
| `tray.py` | pystray tray + balloon | 135 | rework | S — Electron `Tray` + `Notification` (built in) |
| `ui_theme.py` | dark ttk theme | 74 | web | S — CSS (`style.css` exists) |
| `wl_embed.py` | settings embedded in the `.filter` as base64 zlib | 77 | direct | S — use **pako 2.1.0** (R1) |
| `wl_import.py` | read v1 / v2 old whitelist files back | 442 | direct | M |
| `wl_model.py` | Whitelist tab model (no Tk) | 767 | direct | L |
| `wl_panel.py` | Whitelist tab Tk body | 741 | web | L — `tab_wl.js` (402) exists; port to TS + the equipment sub tabs |
| `wl_session.py` | messages / decisions when a file is opened | 107 | direct | S |

## web/

| File | What it does | Lines | Type | Size / note |
|---|---|---:|---|---|
| `glue.py` | Pyodide entry points (JSON in / out, one `WlModel`) | 344 | rework | M — becomes a typed facade `packages/core/src/api.ts`; the web page and Electron call it directly |
| `py/*.py` + `manifest.json` | generated copies of the shared modules (`tools/sync_web_py.py`) | 3,491 | drop | no copy step in TS |
| `app.js` | page controller (lists, generate, settings in localStorage) | 342 | web | M — JS -> TS, becomes the shared renderer |
| `js/data.js` `files.js` `open_filter.js` `store.js` `util.js` | hub / NeverSink / names fetch, File System Access, IndexedDB, helpers | 518 | web | M — browser-only parts stay in `apps/web`; Electron gets a `node:fs` implementation behind the same interface |
| `js/style_dialog.js` `tab_ns.js` `tab_wl.js` | style dialog, NeverSink tab, Whitelist tab | 632 | web | M-L |
| `index.html`, `style.css` | page + dark theme | 221 | web | S |
| `data/trade_names_poe1/2.json` | names snapshot (fallback) | - | keep | copy as is; refreshed by `tools/refresh_web_names.py` (port to a script) |

## tools/

| File | What it does | Lines | Type | Size / note |
|---|---|---:|---|---|
| `build_mod_meta.py` | RePoE datamine -> `mod_meta.json` | 228 | keep as Python at first | S-M — dev tool; output file is copied; port later only if wanted |
| `build_icon.py` | draws `icon.ico` | 52 | rework | S — reuse the `.ico`; electron-builder takes it |
| `build_web.py`, `sync_web_py.py`, `serve_web.py` | web build / copy / dev server | 161 | drop | vite replaces all three |
| `refresh_web_names.py` | refresh `data/trade_names_*.json` (keeps the old snapshot if the list shrinks) | 37 | direct | S — node script |
| `compare_neversink.py`, `verify_anchors.py` | dev checks against NeverSink / hub anchors | 299 | direct | S each, optional (phase 1+) |
| `probe_*.py` (13) + `*_result.txt` | one-off API probes (poe.ninja, poe2scout, trade URL, leagues) | 658 | drop | obsolete (hub replaced them) |

## tests/ (Python, 432 test functions in 37 files; 607 cases with parametrisation)

| Group | Files (functions) | Plan |
|---|---|---|
| Pure logic, convert to vitest | `test_filter_core` (11), `test_filter_gen` (26), `test_filter_output` (14), `test_filter_service` (11), `test_filter_service_golden` (1), `test_filter_sounds_e2e` (3), `test_filter_vocabulary` (3), `test_filter_whitelist` (30), `test_bad_names` (6), `test_sound_split` (6 of 7), `test_hub_client` (8), `test_neversink_source` (8), `test_item_parser` (15), `test_poe2_magic` (3), `test_poe2_parser` (9), `test_meta_db` (16), `test_mod_badge` (44), `test_wl_a3` (11), `test_wl_import` (17), `test_wl_neversink_blocks` (8), `test_wl_quest` (5), `test_wl_rarity` (15), `test_wl_session_golden` (1), `test_wl_tier_d` (15), `test_wl_equip` (~13 of 17), `test_filter_phase1` (14 of 20), `test_filter_gen_standalone` (1 of 6) | **about 325 functions -> vitest**, mostly mechanical (pytest -> vitest, same fixtures and golden files) |
| Tk tests, rewrite | `test_wl_ui` (18), `test_wl_phase3b` (14 of 25), `test_filter_phase1` (6), `test_filter_gen_standalone` (5), `test_wl_equip` (~4 tabs), `test_thai_combobox` (3, Tk-only Thai-rendering bug) | **about 50 functions** -> vitest + jsdom for model-level checks, Playwright for what the renderer shows (the existing `tests/web_ui/ui.mjs` has 133 checks against the same page and is reused) |
| Web-specific, re-point | `test_web_glue` (11, Pyodide glue), `test_web_parity` (6), `test_web_ui` (4) | glue tests -> core `api.ts` tests; **parity tests become the TS-vs-Python harness** (PLAN section C4); `test_web_ui` -> a Playwright script |
| Price mode / build, drop | `test_matcher` (7), `test_normalizer` (8), `test_repository` (16; the league-index cases move to the `hub_client` tests), `test_build_web` (4) | not converted |
| Data | `tests/sample_data/` (hub / names `.gz`, NeverSink s2 + base filters for both games, old filters, golden JSON; about 2.5 MB) | copy as is, they are the shared fixtures |

## External data (unchanged)

hub (`storage.googleapis.com/poe-data-hub`: `{game}/prices/index.json`, prices, `poe2/meta/latest.json`, passives),
NeverSink GitHub (tag + raw filter), GGG `trade(2)/data/items` + `data/stats`, committed `trade_names_*.json` snapshot,
`mod_meta.json` (RePoE). All plain HTTPS GET with no auth; the web page already fetches the same URLs from a browser
(CORS is fine), Electron / Node use `fetch`.

## Where the price (OCR) mode lives, for the future

`poe_price_trade/ocr/` (`base.py`, `windows_ocr.py`), `capture.py`, `scan.py`, `motion.py`, `matcher.py`,
`normalizer.py`, `repository.py`, `overlay.py` (price display), the F4 scan -> hover loop in `app.py`
(`_on_f4_scan` and the hover thread), tests `test_matcher`, `test_normalizer`, `test_repository`; deps in
`requirements.txt` (`winrt-*`). Config keys that go with it: `overlay_opacity`, `price_offset_px`, `match_threshold`,
`currency_unit`, `f4_mode`.
