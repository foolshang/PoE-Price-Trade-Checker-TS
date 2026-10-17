# Phase 3 - the Filter Generator on Electron (`apps/filtergen`)

Status: built as a one-click installer (`dist\PoE-Filter-Generator-TS-Setup-<version>.exe`, now v1.0.0-beta.6; the first build was a
portable exe, dropped because it opened in 9-10 s) and tested here; waiting for Winai's test on the real game folders. **No release, no tag.** Title bar: `PoE1 & PoE2 Filter Generator (TypeScript) v<version>`.

## What it is

The same page as the web (`packages/ui`, nothing duplicated) in an Electron window, with the browser parts swapped for desktop ones
through one seam, `packages/ui/src/platform.ts` (the browser page uses the defaults):

| Part | Browser page | Desktop app |
|---|---|---|
| network | `fetch` (hub CORS only allows the Pages origin) | main process, Chromium `net.fetch`, three allowed hosts only |
| real item names | snapshot shipped with the page | GGG's trade data (7-day disk cache) first, the snapshot as the fallback |
| settings + NeverSink cache | localStorage | `%LOCALAPPDATA%\PoeFilterGenTS\config.json` (`filter_gen`, same keys as the original) and `cache\ui-store.json` |
| game folder | File System Access handle | `Documents\My Games\Path of Exile[ 2]` (or the folder picked with **Browse…**), written directly; no download, no zip |
| "เปิด filter…" | folder list after the player picked a folder | the game folder's list at once; "เลือกไฟล์อื่น…" = open dialog; a file from another folder makes that folder the one Generate writes to (like the original) |
| sounds | files picked in the page, kept in IndexedDB | the same (IndexedDB lives in `PoeFilterGenTS\electron`), copied into the game folder by the original's rules |

Desktop-only extras: the *regenerate automatically when NeverSink has a new version* box on the NeverSink tab, the NeverSink update
check 1.5 s after start (regenerates the NeverSink tab when asked, else a warning line), `last_run.txt` / `log.txt`, the first Status
line `PoE Filter Generator v<version> — config: <folder>`, single instance, `icon.ico` of the original.
Kept on purpose: the **Copy** button of the shared page (copies the generated text to the clipboard). Removed: the download
of `.filter` / zip (the file is written).

### Layout

```
apps/filtergen/src/main/index.ts       Electron main: config, game folders, network, window, protocol, single instance
apps/filtergen/src/main/guard.ts       what the page may ask for (pure, unit tested)
apps/filtergen/src/preload/index.ts    window.desktop = the named calls of shared/api.ts, nothing else
apps/filtergen/src/shared/api.ts       the typed surface (DesktopApi)
apps/filtergen/src/renderer/           main.ts (the desktop platform), desktop_folder.ts (FS over IPC), index.html (CSP)
packages/node/src/config.ts            AppConfig (the original's merge rules) + the one-time import
tools/pack-filtergen.mjs, swap-exe.ps1, measure-exe.ps1
tests/desktop/installer.mjs            install over a running version / uninstall / reinstall on this machine (run by hand)
tests/desktop/                         desktop.e2e.ts (Playwright _electron), guard.test.ts, fake internet, certs (test only)
```

## Config and the original's data

- New folder `%LOCALAPPDATA%\PoeFilterGenTS`. First start: `PoeFilterGen\config.json` is read **once** (known keys only, dicts merged key
  by key - the original's rules), written to the new folder with a marker file, and the Status says so. A new folder that already has
  a config is never overwritten. The original's files are only ever read (tested: hash and mtime before/after).
- Sounds the original kept by path (`sound_*`, `style_q`, tier styles): read from that path (only a path the config itself holds) or from
  the game folder, put into the page's sound slots and renamed to the file name. The copy already in the game folder is the same
  content, so it is used as it is - no second copy, no question.
- Every filter with embedded settings (desktop, web, v1, v2) opens: tested with the five old filters in `tests/parity/fixtures/old_filters`.

## Security

`contextIsolation`, `sandbox`, no `nodeIntegration`, `webSecurity`; the page is served from `app://local/` (a protocol handler that stays
inside the renderer folder); CSP both as a header and a meta tag (`default-src 'none'`, `connect-src 'self'`); every permission refused
except writing text to the clipboard; windows cannot be opened or navigated: web links go to the browser, nothing else; devtools
only in unpackaged builds (`POE_DEVTOOLS=1` otherwise).
The page never sends a path. It sends a game id and a **file name** (a plain `.filter` or sound file name, no folders, no reserved
names); the main process owns the folders. The game folder override can only be a folder the player picked in the dialog (or the
config's own value); the page cannot write another one into the settings (put back). URLs: https, three hosts, fixed path prefixes.
Tested in the packaged app: no `require` / `process` / ipc in the page, `window.desktop` is exactly the typed list, `..\` / absolute /
`.exe` names refused, other hosts refused, `fetch` to another site blocked by CSP, window.open / navigation go to `shell.openExternal`.

## Controlled Folder Access

A failed write (EPERM / EACCES / EBADF / ENOENT) shows the original's Thai message: the folder, that Windows may be blocking the
write, *allow `<exe name>` in Windows Security → Ransomware protection or choose a Game folder override*, and the system's text.
Nothing of the system is changed. Tested with a read-only target file (same EPERM).

## Build and install

`npm run desktop:build` (electron-vite: main / preload CJS, renderer) · `npm run desktop:pack` (electron-builder, target **nsis**,
`oneClick`, per user -> `dist\PoE-Filter-Generator-TS-Setup-<version>.exe`; version = root `package.json`) · `npm run desktop:swap`
(= `tools\swap-exe.ps1 -Build`: close the old program, build, silent install over the old one, start the installed program,
check the title bar and that it runs from the installed folder) · `npm run test:desktop`.
Electron's own download script does not run under npm's new script policy: run `npm run desktop:setup` once after `npm install`.

- Installs to `%LOCALAPPDATA%\Programs\PoE-Filter-Generator-TS` (no admin rights), Start menu + Desktop shortcut "PoE Filter Generator
  (TypeScript)", an entry in Windows Settings -> Apps. The installer closes a running copy before it replaces files; a new version
  installs over the old one without uninstalling.
- Uninstall (Settings -> Apps, or `Uninstall PoE-Filter-Generator-TS.exe`) removes the program, the shortcuts and the registry entry only.
  `%LOCALAPPDATA%\PoeFilterGenTS` (settings, cache, sounds) and the game folders are never removed.
- A silent install (`/S`) does not start the program afterwards (the interactive one-click install does); `swap-exe.ps1` starts it.
- The Controlled Folder Access message names the full path of the installed exe, so that is what the player allows in Windows Security.
- The install folder name comes from the package name: the packer sets `extraMetadata.name` (otherwise it was `@poefiltergen`).
- The portable target and its splash image were removed (nothing else used them).

## Measured (this machine, a throw-away LOCALAPPDATA, 4 runs)

| | installed (beta.6) | portable exe (beta.3, dropped) | original (Python exe, v0.13.5) |
|---|---|---|---|
| file to hand out | Setup **98.1 MB** | 88.2 MB | 11.5 MB |
| install time (silent, this machine) | 10-18 s fresh, 21 s over a running copy | - | - |
| size on disk after install | 322 MB | (unpacks 322 MB to TEMP at every start) | 11.5 MB |
| start, program -> window | **0.8 s** (every run, first included) | 9.3-10.6 s | 2.0 s (3.6 s the first time) |
| memory 6 s after start | 358 MB working set (shared pages counted per process) / 223 MB private, 4 processes | 382 / 225 MB, 5 processes | 68 / 34 MB, 2 processes |

Start is now faster than the original; memory is still ~5x the original (Electron's floor, ~250-300 MB working set; no lever planned).

## Not done in this round (decide when the release is prepared)

Automatic updates (electron-updater), a zip that needs no install next to the installer, README / release asset names.

## Tested here

See the phase report. Suites: `npm test` (1,936), `tsc` strict, eslint, `parity:check` (1,451 cases), web `ui.mjs` (119) and web
e2e (39), desktop e2e (39, run against the INSTALLED exe), `tests/desktop/installer.mjs` (21 checks: install over a running older
version, settings survive, uninstall keeps `PoeFilterGenTS` / `PoeFilterGen` / game folders, reinstall).

## Needs Winai

Open the exe: write into the real `Documents\My Games` for both games, open an old filter, sounds (the ones the original copied
earlier), load the filter in PoE1 and PoE2, the settings imported from the original, start speed and smoothness.
