# Phase 3 - the Filter Generator on Electron (`apps/filtergen`)

Status: built (`dist\PoE-Filter-Generator-TS.exe`, v1.0.0-beta.3) and tested here; waiting for Winai's test on the real game
folders. **No release, no tag.** Title bar: `PoE1 & PoE2 Filter Generator (TypeScript) v<version>`.

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

## Build

`npm run desktop:build` (electron-vite: main / preload CJS, renderer) · `npm run desktop:pack` (electron-builder portable ->
`dist\PoE-Filter-Generator-TS.exe`, version = root `package.json`) · `npm run desktop:swap` (= `tools\swap-exe.ps1 -Build`: close the
old exe, build, start the new one, check the title bar) · `npm run test:desktop`.
Electron's own download script does not run under npm's new script policy: run `npm run desktop:setup` once after `npm install`.

## Measured (this machine, a throw-away LOCALAPPDATA, 3 runs)

| | new (Electron, beta.3) | original (Python exe, v0.13.5) |
|---|---|---|
| exe size | **88.2 MB** (PLAN estimate 85-105 MB) | 11.5 MB |
| start, exe -> window | **9.3-10.6 s** (portable exe unpacks ~320 MB every start) | 2.0 s (3.6 s the first time) |
| start of the unpacked app (`win-unpacked`), -> window | 0.8 s | - |
| memory 6 s after start | 382 MB working set (shared pages counted per process) / 225 MB private bytes, 5 processes | 68 MB / 34 MB, 2 processes |

The size is inside the estimate; **start time and memory are much worse than the original.** Where the time goes: the NSIS portable
stub unpacks every start (`unpackDirName` does not change that); LZMA decoding is about half (`compression: store` -> 322 MB exe,
4.7-6.6 s warm), the rest is writing 320 MB (Defender scans it). A splash image (`build/splash.bmp`) is shown while it unpacks.
Levers, from cheapest: (1) ship the unpacked folder as a zip or a NSIS installer (unpacks once, 0.8 s start, but it is not one file);
(2) a small launcher that unpacks once into `%LOCALAPPDATA%\PoeFilterGenTS\app-<version>` and starts from there (one file, slow only
the first time; ~1 day of work, needs Winai's decision); (3) drop `dxcompiler.dll`, `dxil.dll`, SwiftShader / Vulkan (~32 MB,
about 10 %, small risk on machines without a GPU); (4) memory: Electron's floor is ~250-300 MB working set; only the lever
`--disable-gpu`-style flags or a smaller renderer (not planned) would change it.

## Tested here

See the phase report. Suites: `npm test` (1,936), `tsc` strict, eslint, `parity:check` (1,451 cases), web `ui.mjs` (119) and web
e2e (39), desktop e2e (39, also against the packaged `win-unpacked` exe).

## Needs Winai

Open the exe: write into the real `Documents\My Games` for both games, open an old filter, sounds (the ones the original copied
earlier), load the filter in PoE1 and PoE2, the settings imported from the original, start speed and smoothness; decide the start-time lever above.
