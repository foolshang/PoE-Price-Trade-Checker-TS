/**
 * PoE1 & PoE2 Filter Generator (TypeScript) - the Electron main process.
 *
 * It owns everything that touches the machine: the config (%LOCALAPPDATA%\PoeFilterGenTS\config.json, imported once from
 * the original's PoeFilterGen), the game folders, the network for the few allowed hosts, logging, the single instance.
 * The window shows packages/ui from the app:// protocol; the page can only call what preload/index.ts exposes.
 */
import { app, BrowserWindow, Menu, net, protocol, session, shell } from "electron";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AppConfig, IMPORT_MARKER, importOldConfig } from "@poe/node";
import { isExternalLink, isInside } from "@poe/desktop/guard";
import { FilterHost } from "@poe/desktop/host";

declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

const VERSION = __APP_VERSION__;
const TITLE = `PoE1 & PoE2 Filter Generator (TypeScript) v${VERSION}`;

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
const host = new FilterHost({
  config, configDir, version: VERSION, buildTime: __BUILD_TIME__, exeName, documentsDir, log,
  allow: (e) => !!win && e.sender === win.webContents && (e.senderFrame?.url ?? "").startsWith("app://local/"),
  importNote: () => importNote,
});

async function loadAll(): Promise<void> {
  const r = await importOldConfig(configDir, oldConfigDir);
  if (r.message) importNote = r.message;
  log("INFO", `config import: ${r.status}`);
  await config.load();
  await host.load();
}

// ---------------------------------------------------------------------------------------------- window
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
  host.attach(win); // closing = the page saves what is in its boxes first
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

if (gotLock) {
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await loadAll();
    setupSession();
    host.register();
    try {
      writeFileSync(path.join(configDir, "last_run.txt"),
        `v${VERSION}\n${new Date().toISOString()}\nfrozen=${app.isPackaged}\nbuild=${__BUILD_TIME__}\nimport_marker=${existsSync(path.join(configDir, IMPORT_MARKER))}\n`, "utf-8");
    } catch { /* not important */ }
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
}
