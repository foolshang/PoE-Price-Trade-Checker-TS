# Changelog - web page (apps/web)

> The Filter Generator page at https://foolshang.github.io/PoE-Filter-Generator/. The version shown in the page is `web-<version>`.
> Newest entry on top. A web release is made by the same tag as the desktop programs (docs/DEPLOY.md).

## Unreleased (v1.0.1 work)

- Hub files are read only when their `schema_version` is the one this page knows (prices 2, gems 1). A different or missing version is reported in the browser console and treated like a
  hub that could not be reached: no hub list on the whitelist tab, an empty gem list.
- The hub's address is written once (in `@poe/core`); the local preview proxy (`/__hub`) uses the same value.

## web-1.0.0 - 2026-10-21

- Released together with the desktop programs v1.0.0. The page is the TypeScript Filter Generator (no Pyodide), served at the site root; the previous Pyodide page (web-0.13.5) stays at `/legacy/`.
- Same browser data as the old page: `localStorage` keys `poeFilterGen.cfg` / `poeFilterGen.game` and the IndexedDB `poe-filter-gen` v2 (sounds, folder handles) are read unchanged.

## web-1.0.0-beta.1 - 2026-10-17

- First deploy of the TypeScript page at the site root (the old page moved to `/legacy/`): tier and whitelist tabs for both games, byte-equal to the Python original (parity tests), usable in about 0.13 s instead of 2 s.
