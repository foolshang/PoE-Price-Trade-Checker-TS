/**
 * PoE1 & PoE2 Filter Generator (TypeScript) - the Electron main process.
 *
 * It owns everything that touches the machine: the config (%LOCALAPPDATA%\PoeFilterGenTS\config.json, imported once from
 * the original's PoeFilterGen), the game folders, the network for the few allowed hosts, logging, the single instance.
 * The window shows packages/ui from the app:// protocol; the page can only call what preload/index.ts exposes.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HttpError, filterOutput, filterService, tradeNames } from "@poe/core";
import type { HttpPort } from "@poe/core";
import { AppConfig, IMPORT_MARKER, NodeFs, importOldConfig } from "@poe/node";
import type { FilterFileInfo, GameId, InitData } from "../shared/api.ts";
import { MAX_FILE_BYTES, cleanHeaders, collectSoundPaths, enforceGameDirs, isAllowedName, isAllowedUrl, isExternalLink, isGame, isInside } from "./guard.ts";

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

const VERSION = __APP_VERSION__;
const TITLE = `PoE1 & PoE2 Filter Generator (TypeScript) v${VERSION}`;
const KEY_CFG = "poeFilterGen.cfg";
const KEY_GAME = "poeFilterGen.game";

// ---------------------------------------------------------------------------------------------- places and logging
const localAppData = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
const configDir = path.join(localAppData, "PoeFilterGenTS");
const oldConfigDir = path.join(localAppData, "PoeFilterGen"); // the original's folder: only ever read
mkdirSync(configDir, { recursive: true });
app.setPath("userData", path.join(configDir, "electron")); // IndexedDB (the sound files) and the like live here too

// one instance per config folder (the lock is keyed on the userData folder set above); a second start only focuses the first
const gotLock = app.requestSingleInstanceLock();
const logFile = path.join(configDir, "log.txt");
if (gotLock) {
  try {
    writeFileSync(logFile, "", "utf-8"); // a fresh log per start, like the original
  } catch { /* no log then */ }
}
function log(level: string, msg: string): void {
  if (!gotLock) return; // (the running instance owns the log)
  try {
    appendFileSync(logFile, `${new Date().toISOString()} ${level} main: ${msg}\n`, "utf-8");
  } catch { /* nothing to do */ }
}
log("INFO", `PoE Filter Generator v${VERSION} started (frozen=${app.isPackaged}) build=${__BUILD_TIME__}`);

// the CFA message names the exe that has to be allowed: the full path of the installed program
const exeName = process.execPath;
const nodeFs = new NodeFs();

/** The network of the main process is Chromium's (net.fetch): it follows the system proxy settings like a browser does. */
class ElectronHttp implements HttpPort {
  constructor(private timeoutMs = 20000) {}
  async getText(url: string, headers: Record<string, string> = {}): Promise<string> {
    const res = await net.fetch(url, { headers, signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new HttpError(res.status, url);
    return new TextDecoder("utf-8", { fatal: false }).decode(await res.arrayBuffer());
  }
}
const documentsDir = (): string => process.env.POE_FILTERGEN_DOCUMENTS || app.getPath("documents");

// ---------------------------------------------------------------------------------------------- single instance
let win: BrowserWindow | null = null;
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// ---------------------------------------------------------------------------------------------- config
const config = new AppConfig(configDir);
let importNote = "";
let approved: Record<string, string> = { poe1: "", poe2: "" }; // the game_dir_<game> values the page may keep
let soundPaths = new Set<string>(); // paths of the original program's sounds named in the config (the only outside files the page may ask for)
let uiStore: Record<string, string> = {}; // the NeverSink cache and other keys that are not the settings
const cacheFile = path.join(configDir, "cache", "ui-store.json");

const fg = (): Record<string, any> => {
  const v = config.get("filter_gen", {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
};

async function loadAll(): Promise<void> {
  const r = await importOldConfig(configDir, oldConfigDir);
  if (r.message) importNote = r.message;
  log("INFO", `config import: ${r.status}`);
  await config.load();
  approved = { poe1: String(fg().game_dir_poe1 || ""), poe2: String(fg().game_dir_poe2 || "") };
  soundPaths = collectSoundPaths(fg());
  try {
    uiStore = JSON.parse(await fsp.readFile(cacheFile, "utf-8"));
  } catch {
    uiStore = {};
  }
}

let saveTimer: NodeJS.Timeout | null = null;
let cacheDirty = false;
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushSave(), 300);
}
async function flushSave(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await config.save();
    if (cacheDirty) {
      cacheDirty = false;
      await fsp.mkdir(path.dirname(cacheFile), { recursive: true });
      await fsp.writeFile(cacheFile, JSON.stringify(uiStore), "utf-8");
    }
  } catch (e) {
    log("WARNING", `save failed: ${(e as Error).message}`);
  }
}

/** The settings the page reads (poeFilterGen.cfg) = filter_gen without the remembered game. */
function cfgForPage(): string {
  const { standalone_game: _g, ...rest } = fg();
  return JSON.stringify(rest);
}

function gameDir(game: GameId): string {
  return filterOutput.gameFilterDir(nodeFs, documentsDir(), game, approved[game] || "");
}

// ---------------------------------------------------------------------------------------------- ipc
const fromOurPage = (e: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  const url = e.senderFrame?.url ?? "";
  return url.startsWith("app://local/");
};
function handle(channel: string, fn: (e: IpcMainInvokeEvent, ...args: any[]) => unknown): void {
  ipcMain.handle(channel, (e, ...args) => {
    if (!fromOurPage(e)) throw new Error("blocked sender");
    return fn(e, ...args);
  });
}
function on(channel: string, fn: (e: IpcMainEvent, ...args: any[]) => void): void {
  ipcMain.on(channel, (e, ...args) => {
    if (fromOurPage(e)) fn(e, ...args);
  });
}

const bad = (m: string): { ok: false; message: string } => ({ ok: false, message: m });
let lastPicked: { game: GameId; dir: string } | null = null;

function setupIpc(): void {
  handle("init", async (): Promise<InitData> => {
    const store: Record<string, string> = { ...uiStore, [KEY_CFG]: cfgForPage() };
    if (fg().standalone_game === "poe1" || fg().standalone_game === "poe2") store[KEY_GAME] = fg().standalone_game;
    return { version: VERSION, buildTime: __BUILD_TIME__, exeName, configDir, store, importNote };
  });

  on("store:set", (_e, key: unknown, value: unknown) => {
    if (typeof key !== "string" || typeof value !== "string" || value.length > 40 * 1024 * 1024) return;
    if (key === KEY_CFG) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      const clean = enforceGameDirs(parsed as Record<string, any>, approved);
      config.set("filter_gen", { ...clean, standalone_game: fg().standalone_game });
    } else if (key === KEY_GAME) {
      if (value === "poe1" || value === "poe2") config.set("filter_gen", { ...fg(), standalone_game: value });
    } else if (key.startsWith("poeFilterGen.ns.")) {
      uiStore[key] = value;
      cacheDirty = true;
    } else return;
    scheduleSave();
  });
  on("store:del", (_e, key: unknown) => {
    if (typeof key === "string" && key.startsWith("poeFilterGen.ns.") && key in uiStore) {
      delete uiStore[key];
      cacheDirty = true;
      scheduleSave();
    }
  });

  handle("http:get", async (_e, url: unknown, headers: unknown) => {
    if (!isAllowedUrl(url)) return { ok: false, status: 0, text: "blocked address" };
    try {
      const res = await net.fetch(url as string, { headers: cleanHeaders(headers), signal: AbortSignal.timeout(20000) });
      if (!res.ok) return { ok: false, status: res.status, text: "" };
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 40 * 1024 * 1024) return { ok: false, status: 0, text: "response too large" };
      return { ok: true, status: res.status, text: new TextDecoder("utf-8").decode(buf) };
    } catch (e) {
      return { ok: false, status: 0, text: (e as Error).message };
    }
  });

  handle("names:get", async (_e, game: unknown) => {
    if (!isGame(game)) return null;
    try {
      const names = await tradeNames.getNames(game, path.join(configDir, "cache"), {
        fs: nodeFs, http: new ElectronHttp(), now: () => Date.now() / 1000, warn: (m: string) => log("WARNING", m),
      });
      return [...names];
    } catch (e) {
      log("WARNING", `trade names: ${(e as Error).message}`);
      return null;
    }
  });

  handle("folder:info", async (_e, game: unknown) => {
    if (!isGame(game)) return null;
    const dir = gameDir(game);
    return { dir, exists: await nodeFs.isDir(dir), isOverride: !!approved[game] };
  });

  handle("folder:pick", async (_e, game: unknown) => {
    if (!isGame(game) || !win) return null;
    const start = gameDir(game);
    const r = await dialog.showOpenDialog(win, {
      title: "เลือกโฟลเดอร์ filter ของเกม", defaultPath: (await nodeFs.isDir(start)) ? start : documentsDir(), properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    approved[game] = r.filePaths[0];
    log("INFO", `game folder override ${game}: ${approved[game]}`);
    return { dir: approved[game], name: path.basename(approved[game]) || approved[game] };
  });

  handle("folder:clear", (_e, game: unknown) => {
    if (isGame(game)) approved[game] = "";
  });

  handle("fs:filters", async (_e, game: unknown): Promise<FilterFileInfo[]> => {
    if (!isGame(game)) return [];
    const dir = gameDir(game);
    const out: FilterFileInfo[] = [];
    let names: string[] = [];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return [];
    }
    for (const name of names) {
      if (!/\.filter$/i.test(name) || !isAllowedName(name)) continue;
      const p = path.join(dir, name);
      try {
        const st = await fsp.stat(p);
        if (!st.isFile()) continue;
        const fh = await fsp.open(p, "r");
        try {
          const buf = Buffer.alloc(Math.min(2400, st.size));
          await fh.read(buf, 0, buf.length, 0);
          out.push({ name, size: st.size, head: buf.toString("utf-8").slice(0, 600) });
        } finally {
          await fh.close();
        }
      } catch { /* unreadable: not listed */ }
    }
    return out;
  });

  handle("fs:names", async (_e, game: unknown): Promise<string[]> => {
    if (!isGame(game)) return [];
    const dir = gameDir(game);
    try {
      const out: string[] = [];
      for (const ent of await fsp.readdir(dir, { withFileTypes: true })) if (ent.isFile()) out.push(ent.name);
      return out;
    } catch {
      return [];
    }
  });

  handle("fs:exists", async (_e, game: unknown, name: unknown) => isGame(game) && isAllowedName(name) && (await nodeFs.isFile(path.join(gameDir(game), name))));

  handle("fs:read", async (_e, game: unknown, name: unknown) => {
    if (!isGame(game) || !isAllowedName(name)) return bad("ชื่อไฟล์ไม่ถูกต้อง");
    try {
      const buf = await fsp.readFile(path.join(gameDir(game), name));
      return { ok: true, bytes: new Uint8Array(buf) };
    } catch (e) {
      return bad(`อ่านไฟล์ ${name} ไม่ได้: ${(e as Error).message}`);
    }
  });

  handle("fs:write", async (_e, game: unknown, name: unknown, bytes: unknown) => {
    if (!isGame(game) || !isAllowedName(name)) return bad("ชื่อไฟล์ไม่ถูกต้อง");
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_FILE_BYTES) return bad("ข้อมูลไฟล์ไม่ถูกต้อง");
    const dir = gameDir(game);
    try {
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, name), bytes);
      return { ok: true };
    } catch (e) {
      log("WARNING", `write failed ${name}: ${(e as Error).message}`);
      return bad(filterService.writeFailMsg(e, dir, exeName));
    }
  });

  handle("file:pick", async (_e, game: unknown) => {
    if (!isGame(game) || !win) return null;
    const start = gameDir(game);
    const r = await dialog.showOpenDialog(win, {
      title: "เปิด filter", defaultPath: (await nodeFs.isDir(start)) ? start : documentsDir(),
      properties: ["openFile"], filters: [{ name: "Path of Exile filter", extensions: ["filter"] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    const st = await fsp.stat(p);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    lastPicked = { game, dir: path.dirname(p) };
    return { name: path.basename(p), bytes: new Uint8Array(await fsp.readFile(p)), dir: path.dirname(p) };
  });

  handle("folder:adopt-picked", (_e, game: unknown) => {
    if (!isGame(game) || !lastPicked || lastPicked.game !== game) return null;
    const dir = lastPicked.dir;
    lastPicked = null;
    if (path.resolve(dir).toLowerCase() === path.resolve(gameDir(game)).toLowerCase()) return null; // already there
    approved[game] = dir;
    log("INFO", `game folder follows the opened file ${game}: ${dir}`);
    return { dir, name: path.basename(dir) || dir };
  });

  handle("sound:legacy", async (_e, game: unknown, value: unknown) => {
    if (!isGame(game) || typeof value !== "string" || !value) return null;
    const base = path.win32.basename(value);
    if (!isAllowedName(base)) return null;
    const candidates: string[] = [];
    if (soundPaths.has(value)) candidates.push(value); // exactly a path the config itself holds
    candidates.push(path.join(gameDir(game), base), path.join(gameDir(game === "poe1" ? "poe2" : "poe1"), base));
    for (const p of candidates) {
      try {
        const st = await fsp.stat(p);
        if (st.isFile() && st.size <= MAX_FILE_BYTES) return { name: base, bytes: new Uint8Array(await fsp.readFile(p)) };
      } catch { /* next */ }
    }
    return null;
  });
}

// ---------------------------------------------------------------------------------------------- window
let flushAck: (() => void) | null = null;
let closing = false;

function createWindow(): void {
  const iconPath = [path.join(process.resourcesPath, "icon.ico"), path.join(__dirname, "..", "..", "build", "icon.ico")].find((p) => existsSync(p));
  win = new BrowserWindow({
    width: 1000, height: 920, minWidth: 720, minHeight: 560, title: TITLE, icon: iconPath, backgroundColor: "#16181d", show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false,
      devTools: !app.isPackaged || !!process.env.POE_DEVTOOLS,
    },
  });
  win.setMenu(null);
  win.on("page-title-updated", (e) => e.preventDefault());
  win.once("ready-to-show", () => win?.show());
  // the page is the only thing this window shows: links go to the browser, anything else is refused
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith("app://local/")) {
      e.preventDefault();
      if (isExternalLink(url)) void shell.openExternal(url);
    }
  });
  win.on("close", (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    // ask the page to save what is in its boxes, then save and go (a page that does not answer is not waited for)
    const done = new Promise<void>((resolve) => {
      flushAck = resolve;
      setTimeout(resolve, 1500);
    });
    win?.webContents.send("app:flush");
    void done.then(async () => {
      await flushSave();
      win?.destroy();
    });
  });
  win.on("closed", () => {
    win = null;
  });
  void win.loadURL("app://local/index.html");
}

function setupSession(): void {
  const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; " +
    "connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [csp] } });
  });
  // nothing is asked of the player: every permission is refused except writing text to the clipboard (the Copy button)
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "clipboard-sanitized-write"));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === "clipboard-sanitized-write");

  const root = path.join(__dirname, "..", "renderer");
  protocol.handle("app", (request) => {
    const url = new URL(request.url);
    if (url.hostname !== "local") return new Response("not found", { status: 404 });
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/" || rel === "") rel = "/index.html";
    const file = path.join(root, rel);
    if (!isInside(root, file)) return new Response("not found", { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

app.on("web-contents-created", (_e, contents) => {
  contents.on("will-attach-webview", (e) => e.preventDefault());
});

ipcMain.on("app:flush-done", () => flushAck?.());

if (gotLock) {
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await loadAll();
    setupSession();
    setupIpc();
    try {
      writeFileSync(path.join(configDir, "last_run.txt"),
        `v${VERSION}\n${new Date().toISOString()}\nfrozen=${app.isPackaged}\nbuild=${__BUILD_TIME__}\nimport_marker=${existsSync(path.join(configDir, IMPORT_MARKER))}\n`, "utf-8");
    } catch { /* not important */ }
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
