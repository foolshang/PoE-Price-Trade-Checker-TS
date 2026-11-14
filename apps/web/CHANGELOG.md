# Changelog - web page (apps/web)

> The Filter Generator page at https://foolshang.github.io/PoE-Filter-Generator/. The version shown in the page is `web-<version>`.
> Newest entry on top. A web release is made by the same tag as the desktop programs (docs/DEPLOY.md).

## web-1.0.1 - 2026-11-14

- **Item lists follow the league, one set for Hardcore and Softcore:** picking Hardcore on the Whitelist tab loads the item names from the softcore file of the same main league (the Whitelist does not use prices, so the hardcore file is never read); an event uses its own file. The dropdown still offers Hardcore, and Generate logs the league picked and the file the names came from.
- **League choice on the Whitelist tab:** a "ลีก" dropdown lists the main league, the hardcore league and the open events of the game, from the hub's `prices/index.json`. The item lists and
  what Generate uses come from the file of the league picked (before: always the main league's `latest.json`). The choice is kept per game in the browser (`localStorage`, inside the
  page's settings). A remembered league the hub no longer has -> the main league, with a line in the Status. The index not readable (network, wrong `schema_version`) -> only the
  main league (`latest.json`) and a line in the Status. A league file that cannot be loaded -> no hub list (never another league's). The Status names the league used by Generate.
  The hub answers these files to the origin of the page (checked: index, hardcore and event files all carry `Access-Control-Allow-Origin: https://foolshang.github.io`).
- A NeverSink tab without a base filter (GitHub down, nothing cached) now says "✗ nothing to write - no NeverSink base filter available - ไฟล์เดิมไม่ถูกแตะ" after the warning, like the Python original.
- A game or league switch during a list load is loaded again after it, and Generate waits for a load that is running.
- Hub files are read only when their `schema_version` is the one this page knows (prices 2, gems 1). A different or missing version is reported in the browser console and treated like a
  hub that could not be reached: no hub list on the whitelist tab, an empty gem list.
- The hub's address is written once (in `@poe/core`); the local preview proxy (`/__hub`) uses the same value.

## web-1.0.0 - 2026-10-21

- Released together with the desktop programs v1.0.0. The page is the TypeScript Filter Generator (no Pyodide), served at the site root; the previous Pyodide page (web-0.13.5) stays at `/legacy/`.
- Same browser data as the old page: `localStorage` keys `poeFilterGen.cfg` / `poeFilterGen.game` and the IndexedDB `poe-filter-gen` v2 (sounds, folder handles) are read unchanged.

## web-1.0.0-beta.1 - 2026-10-17

- First deploy of the TypeScript page at the site root (the old page moved to `/legacy/`): tier and whitelist tabs for both games, byte-equal to the Python original (parity tests), usable in about 0.13 s instead of 2 s.
